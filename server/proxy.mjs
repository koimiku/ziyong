import { Readable } from "node:stream";
import { browserHeaders, refererByHost } from "./config.mjs";
import { isAllowedProxyHost, rewriteM3u8 } from "./utils.mjs";

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
    const referer =
      String(url.searchParams.get("referer") || "") ||
      refererByHost.get(parsed.hostname) ||
      [...refererByHost.entries()].find(([host]) => parsed.hostname.endsWith(`.${host}`))?.[1] ||
      `${parsed.origin}/`;
    const userAgent = String(url.searchParams.get("ua") || "") || browserHeaders["User-Agent"];

    const upstreamHeaders = {
      ...browserHeaders,
      "User-Agent": userAgent,
      Referer: referer,
    };
    if (request.headers.range) {
      upstreamHeaders.Range = request.headers.range;
    }

    const upstream = await fetch(target, {
      headers: upstreamHeaders,
    });

    const contentType = upstream.headers.get("content-type") || "";
    const isPlaylist =
      /mpegurl|m3u8/i.test(contentType) || /\.m3u8(\?|$)/i.test(parsed.pathname);

    if (isPlaylist) {
      const body = await upstream.text();
      const rewritten = rewriteM3u8(body, target);
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
