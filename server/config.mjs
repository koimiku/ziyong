export const defaultPort = Number(process.env.PORT || process.env.ANIME_PORT || 47890);

export const staticTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
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
    episodePattern:
      /href="\/watch\/(\d+)\/(\d+)\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/gi,
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
    episodePattern:
      /href="\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/gi,
  },
  xgcartoon: {
    name: "西瓜卡通",
    type: "xgcartoon",
    kind: "online",
    partition: "anime",
    origin: "https://www.xgcartoon.com",
    searchUrl: (query) =>
      `https://www.xgcartoon.com/search?q=${encodeURIComponent(query)}`,
    detailUrl: (id) => `https://www.xgcartoon.com/detail/${id}`,
    playPageUrl: (id, chapterId) =>
      `https://www.twxgct.com/video/${id}/${chapterId}.html`,
  },
  mikan: {
    name: "蜜柑计划",
    type: "mikan",
    kind: "torrent",
    partition: "anime",
    origin: "https://mikanani.me",
    searchUrl: (query) =>
      `https://mikanani.me/Home/Search?searchstr=${encodeURIComponent(query)}`,
    detailUrl: (id) =>
      `https://mikanani.me/Home/Search?searchstr=${encodeURIComponent(id)}`,
  },
};

export const browserHeaders = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

export const proxyHosts = new Set([
  "play.xfvod.pro",
  "dl.playxf.top",
  "xgct-video.bzcdn.net",
  "vod.2bdm.cc",
  "static-a.xgcartoon.com",
]);

export const CACHE_TTL_MS = 15 * 60 * 1000;

export const refererByHost = new Map([
  ["play.xfvod.pro", "https://dm1.xfdm.pro/"],
  ["dl.playxf.top", "https://dm1.xfdm.pro/"],
  ["apn.moedot.net", "https://dm1.xfdm.pro/"],
  ["player.moedot.net", "https://dm1.xfdm.pro/"],
  ["xgct-video.bzcdn.net", "https://www.xgcartoon.com/"],
  ["vod.2bdm.cc", "https://www.gugu3.com/"],
  ["s1.fengbao9.com", "https://omofun04.top/"],
  ["cdn.vvvip-plays33.cc", "https://omofun04.top/"],
  ["vip.dytt-kan.com", "https://omofun04.top/"],
]);
