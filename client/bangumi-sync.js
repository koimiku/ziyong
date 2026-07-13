import { bangumiRequest } from "./bangumi-http.js";
import {
  getWatchHistory,
  mergeExternalHistory,
  resolveEpisodeNumber,
} from "./watch-history.js";

const TOKEN_KEY = "anime-bangumi-token";
const USER_KEY = "anime-bangumi-user";
const META_KEY = "anime-bangumi-sync-meta";

const COLLECTION_DOING = 3;
const COLLECTION_COLLECT = 2;

let syncTimer = null;
let syncing = false;

export function getBangumiToken() {
  try {
    return String(localStorage.getItem(TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function getBangumiUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getBangumiSyncMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : { lastSyncAt: 0, lastError: "" };
  } catch {
    return { lastSyncAt: 0, lastError: "" };
  }
}

function setMeta(patch) {
  const next = { ...getBangumiSyncMeta(), ...patch };
  localStorage.setItem(META_KEY, JSON.stringify(next));
  document.dispatchEvent(new CustomEvent("anime:bangumi-sync-changed", { detail: next }));
  return next;
}

function setUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
  document.dispatchEvent(new CustomEvent("anime:bangumi-auth-changed", { detail: { user } }));
}

export function isBangumiLoggedIn() {
  return Boolean(getBangumiToken() && getBangumiUser()?.username);
}

export function getBangumiSubjectId(itemOrId) {
  const raw = typeof itemOrId === "object" && itemOrId ? itemOrId.id : itemOrId;
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function loginBangumiWithToken(tokenInput) {
  const token = String(tokenInput || "").trim();
  if (!token) throw new Error("请粘贴 Bangumi Access Token");

  const response = await bangumiRequest("/v0/me", { token });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`登录失败 (${response.status})${detail ? `：${detail.slice(0, 120)}` : ""}`);
  }
  const me = await response.json();
  if (!me?.username) throw new Error("未能读取 Bangumi 用户信息");

  localStorage.setItem(TOKEN_KEY, token);
  setUser({
    id: me.id,
    username: me.username,
    nickname: me.nickname || me.username,
    avatar: me.avatar?.large || me.avatar?.medium || "",
  });
  setMeta({ lastError: "" });
  await syncBangumiHistory({ reason: "login" });
  return getBangumiUser();
}

export function logoutBangumi() {
  localStorage.removeItem(TOKEN_KEY);
  setUser(null);
  setMeta({ lastError: "", lastSyncAt: 0 });
}

async function fetchAllCollections(token, username) {
  const list = [];
  let offset = 0;
  const limit = 50;

  for (let page = 0; page < 20; page += 1) {
    const response = await bangumiRequest(
      `/v0/users/${encodeURIComponent(username)}/collections?subject_type=2&limit=${limit}&offset=${offset}`,
      { token }
    );
    if (!response.ok) {
      throw new Error(`拉取收藏失败 (${response.status})`);
    }
    const payload = await response.json();
    const chunk = Array.isArray(payload?.data) ? payload.data : [];
    list.push(...chunk);
    if (chunk.length < limit) break;
    offset += limit;
  }

  return list;
}

function collectionToHistoryEntry(row) {
  const subject = row?.subject;
  const subjectId = Number(subject?.id || row?.subject_id || 0);
  if (!subjectId) return null;

  const epStatus = Number(row.ep_status || 0);
  const updatedAt = Date.parse(row.updated_at || "") || Date.now();
  const title = subject?.name || "";
  const titleCn = subject?.name_cn || "";

  return {
    id: subjectId,
    partition: "anime",
    title,
    title_cn: titleCn,
    displayType: subject?.platform || "TV",
    score: Number(subject?.score || 0) || null,
    images: subject?.images || {},
    sourceUrl: `https://bgm.tv/subject/${subjectId}`,
    watchedAt: updatedAt,
    bangumi: {
      collectionType: Number(row.type || 0),
      epStatus,
      syncedAt: Date.now(),
    },
    progress:
      epStatus > 0
        ? {
            episodeNumber: epStatus,
            episodeLabel: `第${epStatus}集`,
            episodeNid: epStatus,
            percent: Number(row.type) === COLLECTION_COLLECT ? 100 : 0,
            position: 0,
            duration: 0,
            updatedAt,
            fromBangumi: true,
          }
        : null,
  };
}

async function pushSubjectProgress(token, subjectId, episodeNumber, { finished = false } = {}) {
  if (!subjectId || !episodeNumber || episodeNumber < 1) return;

  const type = finished ? COLLECTION_COLLECT : COLLECTION_DOING;
  const body = {
    type,
    ep_status: episodeNumber,
  };

  const response = await bangumiRequest(`/v0/users/-/collections/${subjectId}`, {
    method: "POST",
    token,
    body,
  });

  if (response.status === 404 || response.status === 400) {
    // Some accounts need POST create then PATCH; try PATCH as fallback.
    const patch = await bangumiRequest(`/v0/users/-/collections/${subjectId}`, {
      method: "PATCH",
      token,
      body,
    });
    if (!patch.ok && patch.status !== 204) {
      const detail = await patch.text().catch(() => "");
      throw new Error(`同步进度失败 (${patch.status}) ${detail.slice(0, 80)}`);
    }
    return;
  }

  if (!response.ok && response.status !== 204) {
    const detail = await response.text().catch(() => "");
    throw new Error(`同步进度失败 (${response.status}) ${detail.slice(0, 80)}`);
  }
}

export async function syncBangumiHistory({ reason = "manual" } = {}) {
  const token = getBangumiToken();
  const user = getBangumiUser();
  if (!token || !user?.username) {
    throw new Error("尚未登录 Bangumi");
  }
  if (syncing) return getWatchHistory();
  syncing = true;

  try {
    const collections = await fetchAllCollections(token, user.username);
    const remoteEntries = collections.map(collectionToHistoryEntry).filter(Boolean);
    mergeExternalHistory(remoteEntries);

    // Push local anime progress that is ahead of Bangumi.
    const remoteById = new Map(
      collections.map((row) => [Number(row.subject?.id || row.subject_id || 0), row])
    );

    for (const entry of getWatchHistory({ partition: "anime" })) {
      const subjectId = getBangumiSubjectId(entry);
      if (!subjectId) continue;
      const localEp = resolveEpisodeNumber(entry.progress);
      if (!localEp) continue;
      const remote = remoteById.get(subjectId);
      const remoteEp = Number(remote?.ep_status || 0);
      if (localEp <= remoteEp) continue;
      const finished = Number(entry.progress?.percent || 0) >= 98;
      await pushSubjectProgress(token, subjectId, localEp, { finished });
    }

    setMeta({ lastSyncAt: Date.now(), lastError: "", lastReason: reason });
    return getWatchHistory();
  } catch (error) {
    setMeta({ lastError: String(error?.message || error) });
    throw error;
  } finally {
    syncing = false;
  }
}

export function scheduleBangumiProgressPush(itemId, progress) {
  const token = getBangumiToken();
  if (!token) return;
  const subjectId = getBangumiSubjectId(itemId);
  if (!subjectId) return;

  const episodeNumber = resolveEpisodeNumber(progress);
  if (!episodeNumber) return;

  const percent = Number(progress?.percent);
  const finished = Number.isFinite(percent) ? percent >= 90 : false;
  // Bangumi ep_status = 已看集数；播到一半时推当前集，接近结束也推当前集。
  const epStatus = episodeNumber;

  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    pushSubjectProgress(token, subjectId, epStatus, { finished }).catch((error) => {
      console.warn("[bangumi-sync]", error);
      setMeta({ lastError: String(error?.message || error) });
    });
  }, 1200);
}

export async function initializeBangumiSync() {
  if (!isBangumiLoggedIn()) return null;
  try {
    await syncBangumiHistory({ reason: "startup" });
  } catch (error) {
    console.warn("[bangumi-sync] startup sync failed:", error);
  }
  return getBangumiUser();
}
