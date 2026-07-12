import { browserHeaders } from "./config.mjs";
import { getCache, setCache } from "./cache.mjs";
import { buildStreamPayload, decodeHtml } from "./utils.mjs";

const ORIGIN = "https://tokuzilla.net";

const tokuzillaHeaders = {
  ...browserHeaders,
  Referer: `${ORIGIN}/`,
};

function slugFromUrl(url) {
  const match = String(url || "").match(/\/watch\/([^/?#]+)\.html/i);
  return match?.[1] || "";
}

function normalizeTitle(raw) {
  return decodeHtml(String(raw || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractYear(text) {
  const match = String(text || "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function parseCardBlock(imgBlock, titleBlock, seen) {
  const url = imgBlock.match(/href="(https:\/\/tokuzilla\.net\/watch\/[^"?#]+\.html)"/i)?.[1];
  if (!url) return null;

  const slug = slugFromUrl(url);
  if (!slug || seen.has(slug)) return null;
  seen.add(slug);

  const rawTitle =
    imgBlock.match(/<a[^>]+title="([^"]+)"/i)?.[1] ||
    titleBlock.match(/<a[^>]+title="([^"]+)"/i)?.[1] ||
    titleBlock.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
    slug;
  const name = normalizeTitle(rawTitle);
  const yearSource = `${titleBlock} ${name}`;
  const year =
    Number(titleBlock.match(/<span class="year"[^>]*>[\s\S]*?(\d{4})/i)?.[1]) ||
    extractYear(yearSource) ||
    null;
  const pic = imgBlock.match(/<img[^>]+src="([^"]+)"/i)?.[1] || "";

  return {
    id: slug,
    name,
    year,
    pic,
    url,
  };
}

function parseTokuzillaCards(html) {
  const items = [];
  const seen = new Set();

  const homePattern =
    /<div class="col-sm-4 col-xs-12 item post">([\s\S]*?)<\/div>\s*<h3>([\s\S]*?)<\/h3>\s*<\/div>/gi;

  for (const match of html.matchAll(homePattern)) {
    const item = parseCardBlock(match[1], match[2], seen);
    if (item) items.push(item);
  }

  if (items.length) return items;

  const searchPattern =
    /<div class="col-sm-4 col-xs-12 item">[\s\S]*?<div class="item-img">([\s\S]*?)<\/div>\s*<\/div>/gi;

  for (const match of html.matchAll(searchPattern)) {
    const block = match[1];
    const item = parseCardBlock(block, block, seen);
    if (item) items.push(item);
  }

  return items;
}

function sliceLatestUpdatesSection(html) {
  const start = html.indexOf("Latest Updates");
  if (start < 0) return html;
  return html.slice(start, start + 32000);
}

async function fetchHtml(url) {
  const cacheKey = `tokuzilla-page:${url}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(url, { headers: tokuzillaHeaders });
  if (!upstream.ok) {
    throw new Error(`Tokuzilla upstream failed: ${upstream.status}`);
  }
  const html = await upstream.text();
  setCache(cacheKey, html);
  return html;
}

export async function fetchTokuzillaLatest() {
  const html = await fetchHtml(`${ORIGIN}/`);
  return parseTokuzillaCards(sliceLatestUpdatesSection(html)).slice(0, 24);
}

export async function searchTokuzilla(query) {
  const html = await fetchHtml(`${ORIGIN}/?s=${encodeURIComponent(query)}`);
  return parseTokuzillaCards(html).slice(0, 24);
}

function cleanDetailTitle(raw) {
  return normalizeTitle(raw)
    .replace(/^ENGLISH SUB[】\]]*\s*/i, "")
    .replace(/\s*[|｜]\s*TokuZilla\.Net.*$/i, "")
    .replace(/\s*-\s*(19|20)\d{2}\s*$/, "")
    .trim();
}

function extractMeta(html) {
  const title =
    cleanDetailTitle(
      html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1] ||
        html.match(/<title>([^<]+)<\/title>/i)?.[1]
    ) || "Tokusatsu";

  const poster =
    html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] ||
    html.match(/<img[^>]+class="[^"]*video-img[^"]*"[^>]+src="([^"]+)"/i)?.[1] ||
    "";

  const year =
    extractYear(title) ||
    Number(html.match(/<span class="meta-info">Year<\/span>[\s\S]*?<td>[\s\S]*?(\d{4})/i)?.[1]) ||
    null;

  return { title, poster, year };
}

export function parseTokuzillaLines(html, slug) {
  const episodes = [];
  const pattern =
    /href="(?:https:\/\/tokuzilla\.net)?\/watch\/[^"?]+\.html\?ep=(\d+)#watch"[^>]*>(\d+)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const ep = Number(match[1]);
    if (!ep || episodes.some((item) => item.nid === ep)) continue;
    const pageUrl = `${ORIGIN}/watch/${slug}.html?ep=${ep}#watch`;
    episodes.push({
      sid: 1,
      nid: ep,
      label: `第 ${ep} 集`,
      pageUrl,
      playApi: `/api/source-play?source=tokuzilla&id=${encodeURIComponent(slug)}&ep=${ep}`,
    });
  }

  episodes.sort((a, b) => a.nid - b.nid);

  if (!episodes.length) {
    episodes.push({
      sid: 1,
      nid: 1,
      label: "播放",
      pageUrl: `${ORIGIN}/watch/${slug}.html#watch`,
      playApi: `/api/source-play?source=tokuzilla&id=${encodeURIComponent(slug)}&ep=1`,
    });
  }

  return [
    {
      sid: 1,
      name: "Tokuzilla",
      episodes,
    },
  ];
}

export async function detailTokuzilla(slug) {
  const safeSlug = String(slug || "").trim();
  if (!safeSlug) throw new Error("Missing tokuzilla slug");

  const detailUrl = `${ORIGIN}/watch/${safeSlug}.html`;
  const html = await fetchHtml(detailUrl);
  const meta = extractMeta(html);

  return {
    source: "tokuzilla",
    name: "Tokuzilla",
    id: safeSlug,
    detailUrl,
    kind: "online",
    title: meta.title,
    poster: meta.poster,
    year: meta.year,
    lines: parseTokuzillaLines(html, safeSlug),
  };
}

export async function resolveTokuzillaStream(slug, ep = 1) {
  const safeSlug = String(slug || "").trim();
  const episode = Number(ep) || 1;
  const pageUrl = `${ORIGIN}/watch/${safeSlug}.html?ep=${episode}#watch`;
  const html = await fetchHtml(pageUrl);

  const iframeMatch =
    html.match(/<iframe[^>]+id=['"]frame['"][^>]+src=['"]([^'"]+)['"]/i) ||
    html.match(/<iframe[^>]+src=['"]([^'"]+)['"][^>]+id=['"]frame['"]/i);

  const iframeSrc = iframeMatch?.[1];
  if (iframeSrc && /^https?:\/\//i.test(iframeSrc)) {
    return buildStreamPayload(iframeSrc, pageUrl, { Referer: pageUrl });
  }

  return {
    url: "",
    type: "embed",
    pageUrl,
    embedUrl: pageUrl,
  };
}
