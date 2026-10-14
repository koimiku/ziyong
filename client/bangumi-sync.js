import { getCollectionStatus, getPendingCollections, acknowledgeCollection, mergeBangumiCollections } from "./collection-store.js";
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
const EPISODE_WATCHED = 2;
const EPISODE_PAGE = 100;
const EPISODE_BATCH = 80;

let syncTimer = null;
let syncPromise = null;
const COLLECTION_TYPES = { planned: 1, completed: 2, watching: 3 };
const COLLECTION_STATUS_BY_TYPE = { 1: "planned", 2: "completed", 3: "watching" };
const knownCollectionTypes = new Map();
let collectionTimer = null;
let collectionPushPromise = null;
document.addEventListener("anime:collection-changed", () => {
  if (getPendingCollections().length && getBangumiToken()) scheduleCollectionPush();
});
window.addEventListener("online", () => { if (getBangumiToken()) scheduleCollectionPush(); });

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
  clearTimeout(collectionTimer);
  knownCollectionTypes.clear();
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
      const detail = await readErrorDetail(response);
      throw new Error(`拉取收藏失败 (${response.status})${detail ? `：${detail}` : ""}`);
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
    images: subject?.images && Object.keys(subject.images).length ? subject.images : { large: "https://api.bgm.tv/v0/subjects/" + subjectId + "/image?type=large" },
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

async function readErrorDetail(response) {
  const text = await response.text().catch(() => "");
  if (!text) return "";
  try {
    const payload = JSON.parse(text);
    return String(payload.description || payload.title || text).slice(0, 160);
  } catch {
    return text.slice(0, 160);
  }
}

async function writeCollectionType(token, subjectId, type) {
  const response = await bangumiRequest("/v0/users/-/collections/" + subjectId, {
    method: "POST", token, body: { type },
  });
  if (!response.ok && response.status !== 204) {
    throw new Error("收藏同步失败 (" + response.status + ")：" + await readErrorDetail(response));
  }
  knownCollectionTypes.set(subjectId, type);
}
async function ensureAnimeCollection(token, subjectId) {
  const selected = COLLECTION_TYPES[getCollectionStatus(subjectId)];
  if (selected) {
    if (knownCollectionTypes.get(subjectId) !== selected) await writeCollectionType(token, subjectId, selected);
    return;
  }
  if (knownCollectionTypes.has(subjectId)) return;
  const username = getBangumiUser()?.username;
  if (username) {
    const response = await bangumiRequest("/v0/users/" + encodeURIComponent(username) + "/collections/" + subjectId, { token });
    if (response.ok) { knownCollectionTypes.set(subjectId, Number((await response.json()).type)); return; }
    if (response.status !== 404) throw new Error("读取收藏状态失败 (" + response.status + ")");
  }
  await writeCollectionType(token, subjectId, COLLECTION_DOING);
}
export function pushPendingCollections() {
  if (collectionPushPromise) return collectionPushPromise;
  collectionPushPromise = (async () => {
    const token = getBangumiToken();
    if (!token) return;
    for (const entry of getPendingCollections()) {
      if (getBangumiToken() !== token) return;
      await writeCollectionType(token, Number(entry.id), COLLECTION_TYPES[entry.collectionStatus]);
      acknowledgeCollection(entry);
    }
  })().finally(() => { collectionPushPromise = null; });
  return collectionPushPromise;
}
function scheduleCollectionPush() {
  clearTimeout(collectionTimer);
  collectionTimer = setTimeout(() => {
    pushPendingCollections().then(() => {
      if (getPendingCollections().length && getBangumiToken()) scheduleCollectionPush();
      else setMeta({ lastError: "" });
    }).catch(error => setMeta({ lastError: String(error.message || error) }));
  }, 500);
}
async function listMainEpisodeIds(token, subjectId, upToEpisode) {
  const ids = [];
  let offset = 0;

  for (let page = 0; page < 30; page += 1) {
    const response = await bangumiRequest(
      `/v0/episodes?subject_id=${subjectId}&type=0&limit=${EPISODE_PAGE}&offset=${offset}`,
      { token }
    );
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new Error(`读取章节失败 (${response.status})${detail ? `：${detail}` : ""}`);
    }
    const payload = await response.json();
    const chunk = Array.isArray(payload?.data) ? payload.data : [];
    for (const episode of chunk) {
      const number = Number(episode?.ep ?? episode?.sort);
      const id = Number(episode?.id);
      if (!Number.isFinite(number) || number < 1 || number > upToEpisode || !(id > 0)) continue;
      ids.push(id);
    }
    const total = Number(payload?.total);
    offset += chunk.length;
    if (!chunk.length || chunk.length < EPISODE_PAGE || (Number.isFinite(total) && offset >= total)) break;
  }

  return ids;
}

async function markEpisodesWatched(token, subjectId, episodeIds) {
  for (let index = 0; index < episodeIds.length; index += EPISODE_BATCH) {
    const response = await bangumiRequest(`/v0/users/-/collections/${subjectId}/episodes`, {
      method: "PATCH",
      token,
      body: {
        episode_id: episodeIds.slice(index, index + EPISODE_BATCH),
        type: EPISODE_WATCHED,
      },
    });
    if (!response.ok && response.status !== 204) {
      const detail = await readErrorDetail(response);
      throw new Error(`同步进度失败 (${response.status})${detail ? `：${detail}` : ""}`);
    }
  }
}

async function pushSubjectProgress(token, subjectId, episodeNumber, { finished = false } = {}) {
  if (!subjectId || !episodeNumber || episodeNumber < 1) return;

  // Anime progress is stored on each episode. ep_status is only accepted for books.
  await ensureAnimeCollection(token, subjectId, finished);
  const episodeIds = await listMainEpisodeIds(token, subjectId, episodeNumber);
  if (!episodeIds.length) return;
  await markEpisodesWatched(token, subjectId, episodeIds);
}

export function syncBangumiHistory({ reason = "manual" } = {}) {
  if (syncPromise) return syncPromise;
  syncPromise = runBangumiSync(reason).finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

async function runBangumiSync(reason) {
  const token = getBangumiToken();
  const user = getBangumiUser();
  if (!token || !user?.username) {
    throw new Error("尚未登录 Bangumi");
  }

  try {
    const collections = await fetchAllCollections(token, user.username);
    for (const row of collections) knownCollectionTypes.set(Number(row.subject?.id || row.subject_id), Number(row.type));
    const remoteEntries = collections.map(collectionToHistoryEntry).filter(Boolean);
    mergeBangumiCollections(collections.filter(row => COLLECTION_STATUS_BY_TYPE[Number(row.type)]).map(row => ({
      ...collectionToHistoryEntry(row),
      aliases: [row.subject?.name_cn, row.subject?.name].filter(Boolean),
      collectionStatus: COLLECTION_STATUS_BY_TYPE[Number(row.type)],
      collectionRemote: true,
      collectionUpdatedAt: Date.parse(row.updated_at || "") || Date.now(),
    })));
    await pushPendingCollections();
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
