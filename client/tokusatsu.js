import { decorateAnime } from "./bangumi.js";

export function normalizeTokuzillaEntry(entry) {
  const slug = entry.id || entry.slug || "";
  const title = entry.name || entry.title || slug;
  const year = entry.year || null;

  return decorateAnime(
    {
      id: `tz:${slug}`,
      tokuzillaSlug: slug,
      partition: "tokusatsu",
      title,
      title_cn: "",
      title_synonyms: [],
      displayType: "特摄",
      year,
      episodes: null,
      score: null,
      ratingTotal: 0,
      images: {
        large: entry.pic || "",
        common: entry.pic || "",
      },
      synopsis: "",
      sourceUrl: entry.url || `https://tokuzilla.net/watch/${slug}.html`,
    },
    ""
  );
}

export async function fetchTokuzillaLatestFeed() {
  const response = await fetch("/api/tokuzilla/latest", { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Tokuzilla feed failed: ${response.status}`);
  }
  return (payload.list || []).map(normalizeTokuzillaEntry);
}

export async function searchTokuzillaCatalog(query) {
  const response = await fetch(
    `/api/source-search?source=tokuzilla&q=${encodeURIComponent(query)}`
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Tokuzilla search failed: ${response.status}`);
  }
  return (payload.list || []).map(normalizeTokuzillaEntry);
}

export function isTokusatsuItem(item) {
  return item?.partition === "tokusatsu" || String(item?.id || "").startsWith("tz:");
}
