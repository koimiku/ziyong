import { state } from "./state.js";

const STORAGE_KEY = "anime-watch-history";
const MAX_ITEMS = 48;

let syncTimer = null;
let syncReady = false;

function inferPartition(entry) {
  if (entry?.partition === "tokusatsu" || entry?.partition === "anime") {
    return entry.partition;
  }
  return String(entry?.id || "").startsWith("tz:") ? "tokusatsu" : "anime";
}

function normalizeEntry(entry) {
  if (!entry?.id) return null;
  return {
    ...entry,
    id: entry.id,
    partition: inferPartition(entry),
    watchedAt: Number(entry.watchedAt || Date.now()),
    progress: entry.progress || null,
  };
}

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(normalizeEntry).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeLocal(list) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(list.slice(0, MAX_ITEMS).map(normalizeEntry).filter(Boolean))
  );
}

function mergeLists(...lists) {
  const map = new Map();
  lists.flat().forEach((raw) => {
    const entry = normalizeEntry(raw);
    if (!entry) return;
    const current = map.get(entry.id);
    if (!current) {
      map.set(entry.id, entry);
      return;
    }
    const currentTime = Math.max(
      Number(current.watchedAt || 0),
      Number(current.progress?.updatedAt || 0)
    );
    const nextTime = Math.max(
      Number(entry.watchedAt || 0),
      Number(entry.progress?.updatedAt || 0)
    );
    map.set(entry.id, nextTime >= currentTime ? entry : current);
  });

  return [...map.values()]
    .sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0))
    .slice(0, MAX_ITEMS);
}

function saveHistory(list) {
  const next = mergeLists(list);
  writeLocal(next);
  scheduleServerSync(next);
  document.dispatchEvent(new CustomEvent("anime:history-changed"));
  return next;
}

export function mergeExternalHistory(entries = []) {
  if (!Array.isArray(entries) || !entries.length) return getWatchHistory();

  const map = new Map();
  readLocal().forEach((entry) => {
    if (entry?.id != null) map.set(String(entry.id), entry);
  });

  entries.forEach((raw) => {
    const remote = normalizeEntry(raw);
    if (!remote) return;
    const key = String(remote.id);
    const local = map.get(key);
    if (!local) {
      map.set(key, remote);
      return;
    }

    const localEp = resolveEpisodeNumber(local.progress) || 0;
    const remoteEp = resolveEpisodeNumber(remote.progress) || 0;

    if (remoteEp > localEp) {
      map.set(
        key,
        normalizeEntry({
          ...local,
          ...remote,
          title: local.title || remote.title,
          title_cn: local.title_cn || remote.title_cn,
          images: local.images?.large || local.images?.common ? local.images : remote.images,
          progress: {
            ...(remote.progress || {}),
            // Keep finer local playback only when episode did not move forward.
          },
          watchedAt: Math.max(Number(local.watchedAt || 0), Number(remote.watchedAt || 0)),
        })
      );
      return;
    }

    map.set(
      key,
      normalizeEntry({
        ...local,
        bangumi: remote.bangumi || local.bangumi,
        images: local.images?.large || local.images?.common ? local.images : remote.images || local.images,
        sourceUrl: local.sourceUrl || remote.sourceUrl,
      })
    );
  });

  return saveHistory([...map.values()]);
}

export function resolveEpisodeNumber(progress) {
  if (!progress) return null;
  const direct = Number(progress.episodeNumber);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);

  const fromLabel = String(progress.episodeLabel || "").match(/(\d{1,4})/);
  if (fromLabel) {
    const value = Number(fromLabel[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const fromNid = Number(progress.episodeNid);
  if (Number.isFinite(fromNid) && fromNid > 0 && fromNid < 10000) {
    return Math.floor(fromNid);
  }
  return null;
}

function scheduleServerSync(list = readLocal()) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    pushHistoryToServer(list).catch((error) => console.warn(error));
  }, 400);
}

async function pushHistoryToServer(list) {
  try {
    const response = await fetch("/api/watch-history", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ list }),
    });
    if (!response.ok) return;
    const payload = await response.json().catch(() => ({}));
    if (Array.isArray(payload.list)) {
      writeLocal(mergeLists(payload.list, list));
    }
  } catch (error) {
    console.warn(error);
  }
}

export async function initializeWatchHistory() {
  if (syncReady) return getWatchHistory();
  syncReady = true;

  try {
    const response = await fetch("/api/watch-history", { cache: "no-store" });
    if (response.ok) {
      const payload = await response.json().catch(() => ({}));
      const merged = mergeLists(readLocal(), payload.list || []);
      writeLocal(merged);
      await pushHistoryToServer(merged);
    }
  } catch (error) {
    console.warn(error);
  }

  window.addEventListener("pagehide", () => {
    const list = readLocal();
    try {
      navigator.sendBeacon?.(
        "/api/watch-history",
        new Blob([JSON.stringify({ list })], { type: "application/json" })
      );
    } catch {
      // ignore
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      scheduleServerSync();
    }
  });

  return getWatchHistory();
}

export function getWatchHistory(options = {}) {
  const mode = options.partition || options.mode || null;
  const list = readLocal();
  if (!mode || mode === "all") return list;
  return list.filter((entry) => inferPartition(entry) === mode);
}

export function getWatchHistoryForCurrentMode() {
  const mode = state.contentMode === "tokusatsu" ? "tokusatsu" : "anime";
  return getWatchHistory({ partition: mode });
}

export function recordWatch(item, progressPatch = null) {
  if (!item?.id) return;

  const previous = readLocal().find((row) => row.id === item.id);
  const entry = normalizeEntry({
    id: item.id,
    partition: item.partition || inferPartition(item),
    tokuzillaSlug: item.tokuzillaSlug || null,
    title: item.title,
    title_cn: item.title_cn,
    displayType: item.displayType,
    year: item.year,
    score: item.score,
    ratingTotal: item.ratingTotal,
    images: item.images,
    title_synonyms: item.title_synonyms,
    aliases: item.aliases,
    sourceUrl: item.sourceUrl,
    watchedAt: Date.now(),
    progress: progressPatch
      ? { ...(previous?.progress || {}), ...progressPatch, updatedAt: Date.now() }
      : previous?.progress || null,
  });

  saveHistory([entry, ...readLocal().filter((row) => row.id !== item.id)]);
}

export function recordWatchProgress(itemId, progressPatch) {
  if (!itemId || !progressPatch) return;
  const list = readLocal();
  const index = list.findIndex((row) => row.id === itemId);
  if (index < 0) return;

  const current = list[index];
  const nextProgress = {
    ...(current.progress || {}),
    ...progressPatch,
    updatedAt: Date.now(),
  };

  if (nextProgress.duration > 0) {
    nextProgress.percent = Math.min(
      100,
      Math.round((nextProgress.position / nextProgress.duration) * 100)
    );
  }

  list[index] = normalizeEntry({
    ...current,
    watchedAt: Date.now(),
    progress: nextProgress,
  });

  list.sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0));
  saveHistory(list);

  import("./bangumi-sync.js")
    .then(({ scheduleBangumiProgressPush }) => {
      scheduleBangumiProgressPush(itemId, list.find((row) => row.id === itemId)?.progress);
    })
    .catch(() => {});
}

export function getWatchProgress(itemId) {
  return readLocal().find((row) => row.id === itemId)?.progress || null;
}

export function getProgressPercent(entry) {
  const progress = entry?.progress;
  if (!progress) return 0;
  if (Number.isFinite(progress.percent)) return Math.max(0, Math.min(100, progress.percent));
  if (progress.duration > 0 && progress.position >= 0) {
    return Math.min(100, Math.round((progress.position / progress.duration) * 100));
  }
  return 0;
}

export function formatProgressLabel(entry) {
  const progress = entry?.progress;
  if (!progress) return "";
  const parts = [];
  if (progress.episodeLabel) parts.push(progress.episodeLabel);
  const percent = getProgressPercent(entry);
  if (percent > 0 && percent < 98) parts.push(`${percent}%`);
  else if (percent >= 98) parts.push("已看完");
  return parts.join(" · ");
}

export function resolveHistoryItems(history, catalog = []) {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  return history
    .map((row) => {
      const found = byId.get(row.id);
      if (found) {
        return {
          ...found,
          partition: found.partition || inferPartition(row),
          progress: row.progress,
          watchedAt: row.watchedAt,
        };
      }
      return {
        ...row,
        partition: inferPartition(row),
        aliases: row.aliases || [row.title_cn, row.title].filter(Boolean),
        matchScore: Number(row.score || 0),
      };
    })
    .filter(Boolean);
}
