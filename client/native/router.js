import { detailMaccms, playMaccms, searchMaccms } from "./maccms.js";
import {
  detailTokuzilla,
  fetchTokuzillaLatest,
  playTokuzilla,
  searchTokuzilla,
} from "./tokuzilla.js";
import { watchSources } from "./shared.js";
import { APP_VERSION } from "../version.js";

const BANGUMI_CALENDAR = "https://api.bgm.tv/calendar";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function handleBangumiCalendar() {
  const upstream = await fetch(BANGUMI_CALENDAR, {
    headers: {
      Accept: "application/json",
      "User-Agent": "anime-android/1.3 (standalone)",
    },
  });
  if (!upstream.ok) throw new Error(`Bangumi calendar failed: ${upstream.status}`);
  const days = await upstream.json();
  if (!Array.isArray(days) || !days.length) {
    throw new Error("Bangumi calendar returned empty data");
  }
  return jsonResponse({ days, cached: false, stale: false, cachedAt: Date.now() });
}

async function handleSourceSearch(url) {
  const sourceId = url.searchParams.get("source") || "";
  const query = String(url.searchParams.get("q") || "").trim();
  if (!sourceId || !query) return jsonResponse({ error: "Missing source or query" }, 400);

  const source = watchSources[sourceId];
  if (!source) return jsonResponse({ error: "Unknown source" }, 404);

  const list =
    source.type === "tokuzilla"
      ? await searchTokuzilla(query)
      : await searchMaccms(sourceId, query);

  return jsonResponse({ source: sourceId, name: source.name, list });
}

async function handleSourceDetail(url) {
  const sourceId = url.searchParams.get("source") || "";
  const id = String(url.searchParams.get("id") || "").trim();
  if (!sourceId || !id) return jsonResponse({ error: "Missing source or id" }, 400);

  const source = watchSources[sourceId];
  if (!source) return jsonResponse({ error: "Unknown source" }, 404);

  const payload =
    source.type === "tokuzilla"
      ? await detailTokuzilla(id)
      : await detailMaccms(sourceId, id);

  return jsonResponse(payload);
}

async function handleSourcePlay(url) {
  const sourceId = url.searchParams.get("source") || "";
  const id = String(url.searchParams.get("id") || "").trim();
  const sid = Number(url.searchParams.get("sid") || 1);
  const nid = Number(url.searchParams.get("nid") || url.searchParams.get("ep") || 1);
  if (!sourceId || !id) return jsonResponse({ error: "Missing source or id" }, 400);

  const source = watchSources[sourceId];
  if (!source) return jsonResponse({ error: "Unknown source" }, 404);

  try {
    const stream =
      source.type === "tokuzilla"
        ? await playTokuzilla(id, nid)
        : await playMaccms(sourceId, id, sid, nid);
    if (!stream.url && stream.pageUrl) {
      return jsonResponse(stream);
    }
    if (!stream.url) return jsonResponse({ error: "未获取到可播放地址", pageUrl: stream.pageUrl }, 502);
    return jsonResponse(stream);
  } catch (error) {
    return jsonResponse({ error: String(error?.message || error) }, 502);
  }
}

async function handleWatchHistory(request) {
  if (request.method === "PUT" || request.method === "POST") {
    try {
      const body = await request.json().catch(() => ({}));
      const list = Array.isArray(body.list) ? body.list : [];
      localStorage.setItem("anime-watch-history", JSON.stringify(list));
      return jsonResponse({ list, ok: true });
    } catch (error) {
      return jsonResponse({ error: String(error?.message || error) }, 400);
    }
  }
  try {
    const raw = localStorage.getItem("anime-watch-history");
    const parsed = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.list) ? parsed.list : [];
    return jsonResponse({ list });
  } catch {
    return jsonResponse({ list: [] });
  }
}

export async function handleNativeApi(input, init = {}) {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url, window.location.href);
  const path = url.pathname;

  try {
    if (path === "/api/server-info") {
      return jsonResponse({
        version: `${APP_VERSION}-android`,
        mode: "android-standalone",
        urls: [],
        mobileHint: "安卓独立版：不依赖电脑，内置片源在手机本地解析。",
      });
    }

    if (path === "/api/bangumi/calendar") return handleBangumiCalendar();
    if (path === "/api/tokuzilla/latest") {
      return jsonResponse({ list: await fetchTokuzillaLatest() });
    }
    if (path === "/api/source-search") return handleSourceSearch(url);
    if (path === "/api/source-detail") return handleSourceDetail(url);
    if (path === "/api/source-play") return handleSourcePlay(url);
    if (path === "/api/watch-history") return handleWatchHistory(request);

    if (path === "/api/miru/sources" || path === "/api/miru/repo" || path === "/api/miru/installed") {
      return jsonResponse({
        list: [],
        message: "安卓独立版暂不支持 Miru 扩展，可使用内置片源与 Tokuzilla。",
      });
    }
    if (path === "/api/miru/install" || path === "/api/miru/uninstall") {
      return jsonResponse({ error: "安卓独立版暂不支持安装 Miru 扩展" }, 400);
    }
    if (path === "/api/sources-health" || path === "/api/source-health") {
      return jsonResponse({ list: [], ok: true });
    }
    if (path === "/api/server-qr") {
      return jsonResponse({ error: "安卓独立版无需局域网二维码" }, 404);
    }
    if (path === "/api/media-proxy") {
      const target = url.searchParams.get("url");
      if (!target) return jsonResponse({ error: "Missing url" }, 400);
      return Response.redirect(target, 302);
    }

    return jsonResponse({ error: `未实现接口: ${path}` }, 404);
  } catch (error) {
    return jsonResponse({ error: String(error?.message || error) }, 502);
  }
}
