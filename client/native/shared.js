const UA =
  "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

export const browserHeaders = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "User-Agent": UA,
};

export const watchSources = {
  xfdm: {
    name: "稀饭动漫",
    type: "maccms",
    kind: "online",
    partition: "anime",
    origin: "https://dm1.xfdm.pro",
    suggestUrl: (query) =>
      `https://dm1.xfdm.pro/index.php/ajax/suggest?mid=1&wd=${encodeURIComponent(query)}&limit=10`,
    detailUrl: (id) => `https://dm1.xfdm.pro/bangumi/${id}.html`,
    playPageUrl: (id, sid, nid) => `https://dm1.xfdm.pro/watch/${id}/${sid}/${nid}.html`,
    episodePattern: /href="\/watch\/(\d+)\/(\d+)\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/gi,
  },
  gugu: {
    name: "咕咕番",
    type: "maccms",
    kind: "online",
    partition: "anime",
    origin: "https://www.gugu3.com",
    suggestUrl: (query) =>
      `https://www.gugu3.com/index.php/ajax/suggest?mid=1&wd=${encodeURIComponent(query)}&limit=10`,
    detailUrl: (id) => `https://www.gugu3.com/index.php/vod/detail/id/${id}.html`,
    playPageUrl: (id, sid, nid) =>
      `https://www.gugu3.com/index.php/vod/play/id/${id}/sid/${sid}/nid/${nid}.html`,
    episodePattern:
      /href="\/index\.php\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/gi,
  },
  omofun: {
    name: "Omofun",
    type: "maccms",
    kind: "online",
    partition: "anime",
    origin: "https://omofun04.top",
    suggestUrl: (query) =>
      `https://omofun04.top/index.php/ajax/suggest?mid=1&wd=${encodeURIComponent(query)}&limit=10`,
    detailUrl: (id) => `https://omofun04.top/vod/detail/id/${id}.html`,
    playPageUrl: (id, sid, nid) =>
      `https://omofun04.top/vod/play/id/${id}/sid/${sid}/nid/${nid}.html`,
    episodePattern: /href="\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/gi,
  },
};

export function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)));
}

export function extractPlayerAaaa(html) {
  const match =
    html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i) ||
    html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function decodePlayerUrl(url, encrypt) {
  let value = String(url || "");
  const mode = Number(encrypt || 0);
  if (mode === 1 || mode === 2) {
    try {
      value = atob(value);
    } catch {
      return value;
    }
  }
  if (mode === 2) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep
    }
  }
  return value;
}

export async function nativeFetch(url, options = {}) {
  const headers = { ...browserHeaders, ...(options.headers || {}) };
  const response = await fetch(url, {
    ...options,
    headers,
  });
  return response;
}
