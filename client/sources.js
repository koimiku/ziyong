import { watchSources as builtinSources } from "./config.js";
import { getContentMode } from "./content-mode.js";
import { isTokusatsuItem } from "./tokusatsu.js";
import { getBestMatchScore, normalizeText, pickDisplayTitle } from "./utils.js";

let miruSources = [];

function sourceMatchesMode(source) {
  const mode = getContentMode();
  const partition = source.partition || "anime";
  if (mode === "tokusatsu") return partition === "tokusatsu";
  return partition !== "tokusatsu";
}

export function getWatchSources() {
  return [...builtinSources, ...miruSources].filter(sourceMatchesMode);
}

export function getSourceNamesText() {
  return getWatchSources()
    .filter((source) => source.kind === "online")
    .map((source) => source.name)
    .join("、");
}

export async function refreshWatchSources() {
  try {
    const response = await fetch("/api/miru/sources");
    if (!response.ok) {
      throw new Error(`Miru sources failed: ${response.status}`);
    }
    const payload = await response.json();
    miruSources = (payload.list || []).map((item) => ({
      id: item.id,
      name: `${item.name} · Miru`,
      kind: "online",
      miru: true,
      package: item.package,
      webSite: item.webSite || "",
      searchUrl: (title) =>
        item.webSite
          ? `${String(item.webSite).replace(/\/$/, "")}/?q=${encodeURIComponent(title)}`
          : "#",
    }));
  } catch (error) {
    console.warn(error);
    miruSources = [];
  }
  return getWatchSources();
}

export async function fetchWatchSourceMatches(item) {
  const tokuzillaSlug =
    item.tokuzillaSlug || (String(item.id || "").startsWith("tz:") ? String(item.id).slice(3) : "");
  if (tokuzillaSlug && isTokusatsuItem(item)) {
    const source = getWatchSources().find((entry) => entry.id === "tokuzilla");
    if (source) {
      return [
        {
          source,
          matches: [
            {
              id: tokuzillaSlug,
              name: pickDisplayTitle(item),
              url: item.sourceUrl || `https://tokuzilla.net/watch/${tokuzillaSlug}.html`,
              matchScore: 100,
            },
          ],
          error: null,
        },
      ];
    }
  }

  const queries = getSourceQueryCandidates(item);
  const results = await Promise.all(
    getWatchSources().map(async (source) => {
      try {
        const matches = await searchWatchSource(source, queries);
        return {
          source,
          matches,
          error: null,
        };
      } catch (error) {
        console.warn(error);
        return {
          source,
          matches: [],
          error,
        };
      }
    })
  );
  return results;
}

function getSourceQueryCandidates(item) {
  return [
    ...new Set(
      [pickDisplayTitle(item), item.title_cn, item.title, ...(item.aliases || [])]
        .filter(Boolean)
        .map((value) => String(value).trim())
    ),
  ].slice(0, 3);
}

async function searchWatchSource(source, queries) {
  const collected = new Map();

  for (const query of queries) {
    const payload = await fetchSourceSearch(source.id, query);
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
  }

  return [...collected.values()]
    .filter((entry) => entry.matchScore >= 70)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 4);
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

export async function fetchSourceSearch(sourceId, query) {
  const response = await fetch(
    `/api/source-search?source=${encodeURIComponent(sourceId)}&q=${encodeURIComponent(query)}`
  );
  if (!response.ok) {
    throw new Error(`Source search failed: ${sourceId} ${response.status}`);
  }
  return response.json();
}

export async function fetchSourceDetail(sourceId, id) {
  const response = await fetch(
    `/api/source-detail?source=${encodeURIComponent(sourceId)}&id=${encodeURIComponent(id)}`
  );
  if (!response.ok) {
    throw new Error(`Source detail failed: ${sourceId} ${response.status}`);
  }
  return response.json();
}

export async function loadSourcePlaylists(sourceResults) {
  const playlists = await Promise.all(
    sourceResults.map(async ({ source, matches }) => {
      const candidates = (matches || []).filter((match) => match.matchScore >= 70);
      for (const match of candidates.slice(0, 6)) {
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
            speedRank: source.miru
              ? 5
              : source.id === "tokuzilla"
                ? 0
                : source.id === "xfdm"
                  ? 1
                  : source.id === "xgcartoon"
                    ? 2
                    : source.id === "omofun"
                      ? 3
                      : source.id === "gugu"
                        ? 4
                        : 6,
            lines: detail.lines,
          };
        } catch (error) {
          console.warn(error);
        }
      }
      return null;
    })
  );

  return playlists
    .filter(Boolean)
    .sort((a, b) => a.speedRank - b.speedRank || b.matchScore - a.matchScore);
}

export async function fetchMiruRepo() {
  const response = await fetch("/api/miru/repo", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 404) {
    throw new Error("本地服务版本过旧，请完全退出 anime 后重新打开");
  }
  if (!response.ok) {
    throw new Error(payload.error || `Miru repo failed: ${response.status}`);
  }
  return payload;
}

export async function fetchMiruInstalled() {
  const response = await fetch("/api/miru/installed", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Miru installed failed: ${response.status}`);
  }
  return response.json();
}

export async function installMiruExtension(packageName) {
  const response = await fetch(
    `/api/miru/install?package=${encodeURIComponent(packageName)}`
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Install failed: ${response.status}`);
  }
  await refreshWatchSources();
  return payload;
}

export async function uninstallMiruExtension(packageName) {
  const response = await fetch(
    `/api/miru/uninstall?package=${encodeURIComponent(packageName)}`
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Uninstall failed: ${response.status}`);
  }
  await refreshWatchSources();
  return payload;
}

export async function fetchSourcesHealth() {
  const response = await fetch("/api/sources-health", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Health check failed: ${response.status}`);
  }
  return payload;
}

export async function fetchSourceHealth(sourceId) {
  const response = await fetch(
    `/api/source-health?source=${encodeURIComponent(sourceId)}`,
    { cache: "no-store" }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Health check failed: ${response.status}`);
  }
  return payload;
}
