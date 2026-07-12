import { proxyHosts } from "./config.mjs";

export function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)));
}

export function writeJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
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
      value = Buffer.from(value, "base64").toString("utf8");
    } catch {
      return value;
    }
  }
  if (mode === 2) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep decoded base64 value
    }
  }
  return value;
}

export function proxyMediaUrl(target) {
  return `/api/media-proxy?url=${encodeURIComponent(target)}`;
}

export function allowProxyUrl(target) {
  try {
    proxyHosts.add(new URL(target).hostname);
  } catch {
    // ignore
  }
}

export function isAllowedProxyHost(hostname) {
  if (proxyHosts.has(hostname)) return true;
  return [...proxyHosts].some(
    (host) => hostname === host || hostname.endsWith(`.${host}`)
  );
}

export function rewriteM3u8(body, playlistUrl) {
  return body
    .split(/\r?\n/)
    .map((line) => {
      if (!line || line.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => {
          const absolute = new URL(uri, playlistUrl).href;
          allowProxyUrl(absolute);
          return `URI="${proxyMediaUrl(absolute)}"`;
        });
      }
      const absolute = new URL(line, playlistUrl).href;
      allowProxyUrl(absolute);
      return proxyMediaUrl(absolute);
    })
    .join("\n");
}

export function buildStreamPayload(streamUrl, pageUrl, extraHeaders = {}) {
  const type = /\.m3u8(\?|$)/i.test(streamUrl) || /mpegurl/i.test(streamUrl) ? "hls" : "file";
  let playUrl = streamUrl;
  let proxied = false;

  try {
    const host = new URL(streamUrl).hostname;
    proxyHosts.add(host);
    const params = new URLSearchParams({ url: streamUrl });
    const referer = extraHeaders.Referer || extraHeaders.referer;
    const userAgent = extraHeaders["User-Agent"] || extraHeaders["user-agent"];
    if (referer) params.set("referer", referer);
    if (userAgent) params.set("ua", userAgent);
    playUrl = `/api/media-proxy?${params.toString()}`;
    proxied = true;
  } catch {
    // keep original
  }

  return {
    url: playUrl,
    sourceUrl: streamUrl,
    type,
    proxied,
    pageUrl,
  };
}
