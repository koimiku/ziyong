import { writeJson } from "./utils.mjs";
import { browserHeaders } from "./config.mjs";

const BANGUMI_ORIGIN = "https://api.bgm.tv";
const DEFAULT_UA = "ziyong/1.4.1 (https://github.com/koimiku/ziyong)";

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

export async function handleBangumiGateway(request, response, url) {
  const targetPath = url.pathname.replace(/^\/api\/bangumi/, "") || "/";
  if (!targetPath.startsWith("/v0/") && targetPath !== "/v0") {
    writeJson(response, 400, { error: "Only /v0 API is proxied" });
    return;
  }

  const target = new URL(targetPath + url.search, BANGUMI_ORIGIN);
  const method = String(request.method || "GET").toUpperCase();
  const headers = {
    Accept: "application/json",
    "User-Agent": request.headers["user-agent"] || DEFAULT_UA,
  };
  if (request.headers.authorization) {
    headers.Authorization = request.headers.authorization;
  }
  if (request.headers["content-type"]) {
    headers["Content-Type"] = request.headers["content-type"];
  }

  let body;
  if (method !== "GET" && method !== "HEAD") {
    body = await readBody(request);
    if (!body.length) body = undefined;
  }

  try {
    const upstream = await fetch(target, {
      method,
      headers: {
        ...browserHeaders,
        ...headers,
      },
      body,
    });
    const text = await upstream.text();
    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(text);
  } catch (error) {
    writeJson(response, 502, { error: String(error?.message || error) });
  }
}
