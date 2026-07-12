import { BANGUMI_API_BASE, fallbackAnime } from "./config.js";
import { getBestMatchScore } from "./utils.js";

export function getQueryCandidates(query, localMatches) {
  const extraQueries = localMatches
    .flatMap((item) => [item.title_cn, item.title])
    .filter(Boolean);
  return [...new Set([query, ...extraQueries].map((value) => String(value).trim()))].slice(0, 3);
}

export async function fetchAnimeSearch(query) {
  const response = await fetch(`${BANGUMI_API_BASE}/search/subjects`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      keyword: query,
      sort: "match",
      filter: {
        type: [2],
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }
  const payload = await response.json();
  return (payload.data || []).map(normalizeBangumiSubject);
}

export function mergeAnimeResults(items, query) {
  const fallbackById = new Map(fallbackAnime.map((item) => [item.id, item]));
  const mergedById = new Map();

  items.forEach((item) => {
    const fallback = fallbackById.get(item.id);
    const merged = mergeAnimeItem(item, fallback);
    const current = mergedById.get(merged.id);
    if (!current || Number(merged.score || 0) >= Number(current.score || 0)) {
      mergedById.set(merged.id, merged);
    }
  });

  return [...mergedById.values()].map((item) => decorateAnime(item, query));
}

function mergeAnimeItem(item, fallback) {
  if (!fallback) return item;
  return {
    ...fallback,
    ...item,
    title_synonyms: [
      ...new Set([...(item.title_synonyms || []), ...(fallback.title_synonyms || [])]),
    ],
    synopsis: item.synopsis || fallback.synopsis,
    images: item.images || fallback.images,
  };
}

export function normalizeBangumiCalendarItem(subject) {
  const score = Number(subject.rating?.score || subject.score || 0);
  return {
    id: subject.id,
    title: subject.name,
    title_cn: subject.name_cn,
    title_synonyms: subject.name_cn ? [subject.name_cn] : [],
    typeCode: subject.type,
    displayType: "TV",
    year: getYear(subject.air_date),
    date: subject.air_date,
    air_date: subject.air_date,
    air_weekday: subject.air_weekday,
    episodes: null,
    score,
    ratingTotal: Number(subject.rating?.total || subject.collection?.doing || 0),
    rank: subject.rank,
    tags: [],
    images: subject.images || {},
    synopsis: subject.summary || "",
    sourceUrl: subject.url || (subject.id ? `https://bgm.tv/subject/${subject.id}` : ""),
  };
}

export function normalizeBangumiSubject(subject) {
  const score = Number(subject.rating?.score || subject.score || 0);
  return {
    id: subject.id,
    title: subject.name,
    title_cn: subject.name_cn,
    title_synonyms: extractBangumiAliases(subject),
    typeCode: subject.type,
    displayType: subject.platform || getBangumiTypeLabel(subject.type),
    year: getYear(subject.date),
    date: subject.date,
    episodes: subject.eps || subject.total_episodes || null,
    score,
    ratingTotal: Number(subject.rating?.total || 0),
    rank: subject.rank,
    tags: subject.tags || [],
    images: subject.images || {},
    synopsis: subject.summary || "",
    sourceUrl: subject.id ? `https://bgm.tv/subject/${subject.id}` : "",
  };
}

export function decorateAnime(item, query) {
  const aliases = getAliases(item);
  return {
    ...item,
    aliases,
    matchScore: query ? getBestMatchScore(query, aliases) : Number(item.score || 0),
  };
}

export function getAliases(item) {
  const aliases = [
    item.title,
    item.title_cn,
    item.name,
    item.name_cn,
    ...(item.title_synonyms || []),
  ];
  return [...new Set(aliases.filter(Boolean).map((value) => String(value).trim()))];
}

function extractBangumiAliases(subject) {
  const aliases = [];
  if (!Array.isArray(subject.infobox)) return aliases;

  subject.infobox.forEach((entry) => {
    if (!entry || !/(别名|原名|英文名|中文名)/.test(String(entry.key || ""))) return;
    collectInfoboxValue(entry.value, aliases);
  });

  return aliases;
}

function collectInfoboxValue(value, aliases) {
  if (!value) return;
  if (typeof value === "string") {
    aliases.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectInfoboxValue(item, aliases));
    return;
  }
  if (typeof value === "object") {
    collectInfoboxValue(value.v || value.value || value.name, aliases);
  }
}

function getBangumiTypeLabel(type) {
  const typeLabels = {
    1: "书籍",
    2: "动画",
    3: "音乐",
    4: "游戏",
    6: "三次元",
  };
  return typeLabels[type] || "动画";
}

export function getYear(date) {
  const match = String(date || "").match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

export function getPosterUrl(item) {
  return (
    item.images?.large ||
    item.images?.common ||
    item.images?.medium ||
    item.images?.grid ||
    item.images?.jpg?.large_image_url ||
    item.images?.jpg?.image_url ||
    ""
  );
}

export function formatScore(item) {
  if (!item.score) return "暂无评分";
  const total = item.ratingTotal ? ` / ${item.ratingTotal} 人` : "";
  return `Bangumi ${item.score}${total}`;
}

export function matchesTypeFilter(item, filter) {
  if (filter === "all") return true;
  const displayType = String(item.displayType || "");
  if (filter === "TV") return /TV|WEB|OVA|动画/.test(displayType) && !matchesTypeFilter(item, "Movie");
  if (filter === "Movie") return /剧场版|映画|Movie|movie/.test(displayType);
  return true;
}

export function matchesYearFilter(item, filter) {
  if (!filter || filter === "all") return true;
  const year = Number(item.year);
  if (!year) return filter === "all";
  if (filter === "2020s") return year >= 2020 && year <= 2029;
  if (filter === "2010s") return year >= 2010 && year <= 2019;
  if (filter === "2000s") return year >= 2000 && year <= 2009;
  if (filter === "older") return year < 2000;
  if (/^\d{4}$/.test(filter)) return year === Number(filter);
  return true;
}
