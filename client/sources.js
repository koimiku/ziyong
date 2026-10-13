import { watchSources as builtinSources } from "./config.js";
import { getContentMode } from "./content-mode.js";
import { isTokusatsuItem } from "./tokusatsu.js";
import { getBestMatchScore, normalizeText, pickDisplayTitle } from "./utils.js";

let kazumiSources = [];
let watchSourceRefresh = null;
let defaultSourcesPromise = null;

const DEFAULT_SOURCES_WAIT_MS = 15000;
const SOURCE_SEARCH_TIMEOUT_MS = 15000;

function sourceMatchesMode(source) {
  const mode = getContentMode();
  const partition = source.partition || "anime";
  if (mode === "tokusatsu") return partition === "tokusatsu";
  return partition !== "tokusatsu";
}

export function getWatchSources() {
  return [...builtinSources, ...kazumiSources].filter(sourceMatchesMode);
}

export function getSourceNamesText() {
  return getWatchSources()
    .filter((source) => source.kind === "online")
    .map((source) => source.name)
    .join("、");
}

export async function refreshWatchSources() {
  watchSourceRefresh = loadWatchSources().catch((error) => {
    watchSourceRefresh = null;
    throw error;
  });
  return watchSourceRefresh;
}

export function ensureDefaultSources() {
  if (!defaultSourcesPromise) {
    document.dispatchEvent(new CustomEvent("anime:sources-seeding", { detail: { done: false } }));
    defaultSourcesPromise = fetch("/api/kazumi/seed", { method: "POST" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Kazumi seed failed: ${response.status}`);
        if (payload.installed) await refreshWatchSources();
        return payload;
      })
      .catch((error) => {
        console.warn("[kazumi] default rules", error);
        return null;
      })
      .then((payload) => {
        document.dispatchEvent(
          new CustomEvent("anime:sources-seeding", { detail: { done: true, result: payload } })
        );
        return payload;
      });
  }
  return defaultSourcesPromise;
}

async function loadWatchSources() {
  try {
    const response = await fetch("/api/kazumi/sources");
    if (!response.ok) throw new Error(`Kazumi sources failed: ${response.status}`);
    const payload = await response.json();
    kazumiSources = (payload.list || []).map((item) => ({
      id: item.id,
      name: `${item.name} · 规则`,
      kind: "online",
      kazumi: true,
      package: item.name,
      webSite: item.baseUrl || "",
      searchUrl: (title) =>
        item.baseUrl
          ? `${String(item.baseUrl).replace(/\/$/, "")}/?q=${encodeURIComponent(title)}`
          : "#",
    }));
  } catch (error) {
    console.warn(error);
    kazumiSources = [];
  }

  return getWatchSources();
}

export async function prepareWatchSearch(item) {
  if (defaultSourcesPromise) {
    await Promise.race([
      defaultSourcesPromise,
      new Promise((resolve) => setTimeout(resolve, DEFAULT_SOURCES_WAIT_MS)),
    ]);
  }
  await (watchSourceRefresh || refreshWatchSources());
  const queries = getSourceQueryCandidates(item);
  const tokuzillaSlug =
    item.tokuzillaSlug || (String(item.id || "").startsWith("tz:") ? String(item.id).slice(3) : "");
  if (tokuzillaSlug && isTokusatsuItem(item)) {
    const source = getWatchSources().find((entry) => entry.id === "tokuzilla");
    if (source) {
      return {
        sources: [source],
        queries,
        preset: new Map([
          [
            source.id,
            [
              {
                id: tokuzillaSlug,
                name: pickDisplayTitle(item),
                url: item.sourceUrl || `https://tokuzilla.net/watch/${tokuzillaSlug}.html`,
                matchScore: 100,
              },
            ],
          ],
        ]),
      };
    }
  }
  return { sources: getWatchSources(), queries, preset: new Map() };
}

export function getSourceQueryCandidates(item) {
  return [
    ...new Set(
      [pickDisplayTitle(item), item.title_cn, item.title, ...(item.aliases || [])]
        .filter(Boolean)
        .map((value) => String(value).trim())
    ),
  ].slice(0, 3);
}

export function searchSourceForItem(source, queries, { minScore = 70, limit = 4 } = {}) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("检索超时")), SOURCE_SEARCH_TIMEOUT_MS);
  });
  return Promise.race([searchWatchSource(source, queries, minScore, limit), timeout]).finally(() =>
    clearTimeout(timer)
  );
}

async function searchWatchSource(source, queries, minScore, limit) {
  const collected = new Map();

  // Main title first; aliases only when it yields nothing usable.
  for (const query of queries) {
    let payload;
    try {
      payload = await fetchSourceSearch(source.id, query);
    } catch (error) {
      if (!collected.size) throw error;
      break;
    }
    (payload.list || []).forEach((entry) => {
      if (!entry?.id || !entry?.name || !entry?.url) return;
      const current = collected.get(entry.id);
      const matchScore = scoreSourceTitle(query, entry.name);
      if (!current || matchScore > current.matchScore) {
        collected.set(entry.id, {
          ...entry,
          matchScore,
        });
      }
    });
    if ([...collected.values()].some((entry) => entry.matchScore >= minScore)) break;
  }

  return [...collected.values()]
    .filter((entry) => entry.matchScore >= minScore)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}

function scoreSourceTitle(query, title) {
  const base = getBestMatchScore(query, [title]);
  const normalizedQuery = normalizeText(query);
  const normalizedTitle = normalizeText(title);
  if (!normalizedQuery || !normalizedTitle) return 0;
  if (normalizedTitle === normalizedQuery) return 100;
  if (normalizedTitle.includes(normalizedQuery) && normalizedTitle.length > normalizedQuery.length + 1) {
    return Math.min(base, 72);
  }
  return base;
}

// Browsers allow ~6 connections per host; without ordering, a long tail of rule
// searches blocks the detail request that would let the player mount.
const MAX_SOURCE_REQUESTS = 5;
const requestQueue = [];
let activeRequests = 0;

function scheduleSourceRequest(priority, task) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ priority, task, resolve, reject });
    requestQueue.sort((a, b) => a.priority - b.priority);
    pumpSourceRequests();
  });
}

function pumpSourceRequests() {
  while (activeRequests < MAX_SOURCE_REQUESTS && requestQueue.length) {
    const job = requestQueue.shift();
    activeRequests += 1;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeRequests -= 1;
        pumpSourceRequests();
      });
  }
}

function searchPriority(sourceId) {
  return String(sourceId).startsWith("kazumi:") ? 2 : 1;
}

export async function fetchSourceSearch(sourceId, query) {
  const response = await scheduleSourceRequest(searchPriority(sourceId), () =>
    fetch(`/api/source-search?source=${encodeURIComponent(sourceId)}&q=${encodeURIComponent(query)}`)
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw apiError(payload, `Source search failed: ${sourceId} ${response.status}`);
  }
  return response.json();
}

export async function fetchSourceDetail(sourceId, id) {
  const response = await scheduleSourceRequest(0, () =>
    fetch(`/api/source-detail?source=${encodeURIComponent(sourceId)}&id=${encodeURIComponent(id)}`)
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw apiError(payload, `Source detail failed: ${sourceId} ${response.status}`);
  }
  return response.json();
}

export function apiError(payload, fallback) {
  const error = new Error(payload?.error || fallback);
  if (payload?.code) {
    error.code = payload.code;
    error.verifyUrl = payload.verifyUrl || "";
    error.userAgent = payload.userAgent || "";
  }
  return error;
}

export function isVerifyError(error) {
  return error?.code === "captcha";
}

export function sourceSpeedRank(source) {
  if (source.kazumi) return 6;
  return { tokuzilla: 0, xfdm: 1, xgcartoon: 2, omofun: 3, gugu: 4 }[source.id] ?? 6;
}

export async function loadSourcePlaylist({ source, matches }) {
  let verifyError = null;
  for (const match of (matches || []).slice(0, 6)) {
    try {
      const detail = await fetchSourceDetail(source.id, match.id);
      if (!detail.lines?.length) continue;
      return {
        sourceId: source.id,
        sourceName: source.name,
        matchName: match.name,
        matchUrl: match.url,
        matchScore: match.matchScore,
        kind: source.kind || "online",
        speedRank: sourceSpeedRank(source),
        lines: detail.lines,
      };
    } catch (error) {
      console.warn(error);
      if (isVerifyError(error)) verifyError = error;
    }
  }
  if (verifyError) throw verifyError;
  return null;
}
export async function fetchKazumiRepo() {
  const response = await fetch("/api/kazumi/repo", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Kazumi repo failed: ${response.status}`);
  return payload;
}

export async function fetchKazumiInstalled() {
  const response = await fetch("/api/kazumi/installed", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Kazumi installed failed: ${response.status}`);
  return payload;
}

export async function installKazumiRule(name) {
  const response = await fetch(`/api/kazumi/install?name=${encodeURIComponent(name)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `安装失败: ${response.status}`);
  await refreshWatchSources();
  return payload;
}

export async function importKazumiRule(body) {
  const response = await fetch("/api/kazumi/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `导入失败: ${response.status}`);
  await refreshWatchSources();
  return payload;
}

export async function uninstallKazumiRule(name) {
  const response = await fetch(`/api/kazumi/uninstall?name=${encodeURIComponent(name)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `移除失败: ${response.status}`);
  await refreshWatchSources();
  return payload;
}

export async function fetchSourcesHealth(force = false) {
  const response = await fetch(`/api/sources-health?force=${force ? 1 : 0}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Health check failed: ${response.status}`);
  }
  return payload;
}

export async function fetchSourceHealth(sourceId, force = false) {
  const response = await fetch(
    `/api/source-health?source=${encodeURIComponent(sourceId)}&force=${force ? 1 : 0}`,
    { cache: "no-store" }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Health check failed: ${response.status}`);
  }
  return payload;
}
