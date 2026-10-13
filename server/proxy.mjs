import { Readable } from "node:stream";
import { browserHeaders, refererByHost } from "./config.mjs";
import { NO_REFERER, getMediaHeaders, isAllowedProxyHost, rewriteM3u8 } from "./utils.mjs";

const SITE_BOUND_HEADERS = ["Referer", "Origin", "Cookie"];

// Storage hosts behind a redirect often reject the original site's Referer,
// and browsers would not forward it verbatim either.
export async function fetchFollowingRedirects(target, headers, { hops = 5, signal } = {}) {
  let current = target;
  let currentHeaders = { ...headers };
  for (let hop = 0; hop <= hops; hop += 1) {
    const upstream = await fetch(current, { headers: currentHeaders, redirect: "manual", signal });
    const location = upstream.headers.get("location");
    if (upstream.status < 300 || upstream.status >= 400 || !location) return upstream;
    await upstream.body?.cancel().catch(() => {});
    const next = new URL(location, current);
    if (next.host !== new URL(current).host) {
      currentHeaders = { ...currentHeaders };
      SITE_BOUND_HEADERS.forEach((name) => delete currentHeaders[name]);
    }
    current = next.href;
  }
  throw new Error("Too many redirects");
}

export async function handleMediaProxy(url, request, response) {
  const target = String(url.searchParams.get("url") || "");
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    response.writeHead(400);
    response.end("Bad url");
    return;
  }

  if (!["http:", "https:"].includes(parsed.protocol) || !isAllowedProxyHost(parsed.hostname)) {
    response.writeHead(403);
    response.end("Forbidden host");
    return;
  }

  try {
    const refererParam = String(url.searchParams.get("referer") || "");
    const referer =
      refererParam ||
      refererByHost.get(parsed.hostname) ||
      [...refererByHost.entries()].find(([host]) => parsed.hostname.endsWith(`.${host}`))?.[1] ||
      `${parsed.origin}/`;
    const userAgent = String(url.searchParams.get("ua") || "") || browserHeaders["User-Agent"];

    const upstreamHeaders = {
      ...browserHeaders,
      ...getMediaHeaders(parsed.hostname),
      "User-Agent": userAgent,
    };
    if (referer !== NO_REFERER) upstreamHeaders.Referer = referer;
    if (request.headers.range) {
      upstreamHeaders.Range = request.headers.range;
    }

    const upstream = await fetchFollowingRedirects(target, upstreamHeaders);

    const contentType = upstream.headers.get("content-type") || "";
    const isPlaylist =
      /mpegurl|m3u8/i.test(contentType) || /\.m3u8(\?|$)/i.test(parsed.pathname);

    if (isPlaylist) {
      const body = await upstream.text();
      if (!upstream.ok || !body.trimStart().startsWith("#EXTM3U")) {
        response.writeHead(upstream.ok ? 502 : upstream.status, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Upstream did not return a playlist");
        return;
      }
      const rewritten = rewriteM3u8(body, target, {
        referer: url.searchParams.get("referer") || "",
        ua: url.searchParams.get("ua") || "",
      });
      response.writeHead(200, {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      response.end(rewritten);
      return;
    }

    const headers = {
      "Content-Type": contentType || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    };
    const length = upstream.headers.get("content-length");
    const range = upstream.headers.get("content-range");
    const acceptRanges = upstream.headers.get("accept-ranges");
    if (length) headers["Content-Length"] = length;
    if (range) headers["Content-Range"] = range;
    if (acceptRanges) headers["Accept-Ranges"] = acceptRanges;

    response.writeHead(upstream.status, headers);
    if (!upstream.body) {
      response.end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(response);
  } catch (error) {
    response.writeHead(502);
    response.end(String(error?.message || error));
  }
}
