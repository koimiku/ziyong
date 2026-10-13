import { createHealthMonitor } from "../health-monitor.js";
import { detailMaccms, playMaccms, searchMaccms } from "./maccms.js";
import {
  detailTokuzilla,
  fetchTokuzillaLatest,
  playTokuzilla,
  searchTokuzilla,
} from "./tokuzilla.js";
import { buildStreamPayload, watchSources } from "./shared.js";
import { APP_VERSION } from "../version.js";
import { parseKazumiSourceId, rulePlayPageUrl, rulePlayReferer } from "../kazumi/engine.js";
import { resolveWithSniffFallback } from "./media-sniffer.js";
import {
  detailKazumi,
  ensureKazumiReady,
  fetchKazumiIndex,
  getKazumiRule,
  importKazumiRule,
  installKazumiRule,
  listKazumiRules,
  listKazumiSources,
  resolveKazumiPlay,
  searchKazumi,
  seedDefaultKazumiRules,
  uninstallKazumiRule,
} from "./kazumi/store.js";

const BANGUMI_CALENDAR = "https://api.bgm.tv/calendar";
const HEALTH_QUERY = "海贼王";
const HEALTH_TIMEOUT_MS = 8000;

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
  const headers = {
    Accept: "application/json",
    "User-Agent": `ziyong/${APP_VERSION} (https://github.com/koimiku/ziyong)`,
  };
  const Http = window.Capacitor?.Plugins?.CapacitorHttp;
  let days;
  if (Http?.request) {
    const response = await Http.request({ url: BANGUMI_CALENDAR, method: "GET", headers });
    const status = Number(response?.status || 0);
    const raw = response?.data;
    if (status < 200 || status >= 300) {
      const detail = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
      throw new Error(`Bangumi calendar failed: ${status} ${detail.slice(0, 160)}`);
    }
    days = typeof raw === "string" ? JSON.parse(raw) : raw;
  } else {
    const upstream = await fetch(BANGUMI_CALENDAR, { headers });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      throw new Error(`Bangumi calendar failed: ${upstream.status}${detail ? ` ${detail.slice(0, 160)}` : ""}`);
    }
    days = await upstream.json();
  }
  if (!Array.isArray(days) || !days.length) {
    throw new Error("Bangumi calendar returned empty data");
  }
  return jsonResponse({ days, cached: false, stale: false, cachedAt: Date.now() });
}

async function handleSourceSearch(url) {
  const sourceId = url.searchParams.get("source") || "";
  const query = String(url.searchParams.get("q") || "").trim();
  if (!sourceId || !query) return jsonResponse({ error: "Missing source or query" }, 400);

  const kazumiName = parseKazumiSourceId(sourceId);
  if (kazumiName) {
    await ensureKazumiReady();
    if (!getKazumiRule(kazumiName)) return jsonResponse({ error: "Unknown Kazumi rule" }, 404);
    const list = await searchKazumi(kazumiName, query);
    return jsonResponse({ source: sourceId, name: getKazumiRule(kazumiName)?.name || kazumiName, list });
  }

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

  const kazumiName = parseKazumiSourceId(sourceId);
  if (kazumiName) {
    await ensureKazumiReady();
    if (!getKazumiRule(kazumiName)) return jsonResponse({ error: "Unknown Kazumi rule" }, 404);
    return jsonResponse(await detailKazumi(kazumiName, id));
  }

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
  const watch = String(url.searchParams.get("watch") || "");
  const sid = Number(url.searchParams.get("sid") || 1);
  const nid = Number(url.searchParams.get("nid") || url.searchParams.get("ep") || 1);

  const kazumiName = parseKazumiSourceId(sourceId);
  if (kazumiName) {
    if (!watch) return jsonResponse({ error: "Missing watch url" }, 400);
    await ensureKazumiReady();
    if (!getKazumiRule(kazumiName)) return jsonResponse({ error: "Unknown Kazumi rule" }, 404);
    try {
      const rule = getKazumiRule(kazumiName);
      const pageUrl = rulePlayPageUrl(rule, watch);
      const stream = await resolveWithSniffFallback(
        async () => {
          const found = await resolveKazumiPlay(kazumiName, watch);
          return buildStreamPayload(found.mediaUrl, found.pageUrl, found.headers);
        },
        pageUrl,
        rulePlayReferer(rule, pageUrl)
      );
      return jsonResponse(stream);
    } catch (error) {
      return jsonResponse({ error: String(error?.message || error) }, 502);
    }
  }

  if (!sourceId || !id) return jsonResponse({ error: "Missing source or id" }, 400);

  const source = watchSources[sourceId];
  if (!source) return jsonResponse({ error: "Unknown source" }, 404);

  try {
    const stream =
      source.type === "tokuzilla"
        ? await playTokuzilla(id, nid)
        : await resolveWithSniffFallback(
            () => playMaccms(sourceId, id, sid, nid),
            source.playPageUrl(id, sid, nid),
            `${source.origin}/`
          );
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

async function handleKazumiRepo() {
  await ensureKazumiReady();
  const installed = new Set(listKazumiRules().map((item) => item.name));
  const list = (await fetchKazumiIndex()).map((item) => ({
    ...item,
    installed: installed.has(item.name),
  }));
  return jsonResponse({ list });
}

async function handleKazumiInstalled() {
  await ensureKazumiReady();
  return jsonResponse({ list: listKazumiRules() });
}

async function handleKazumiSources() {
  await ensureKazumiReady();
  return jsonResponse({ list: listKazumiSources() });
}

async function handleKazumiSeed() {
  const result = await seedDefaultKazumiRules();
  return jsonResponse({ ok: true, ...result, sources: listKazumiSources() });
}

async function handleKazumiInstall(url) {
  const name = String(url.searchParams.get("name") || "").trim();
  if (!name) return jsonResponse({ error: "Missing rule name" }, 400);
  await ensureKazumiReady();
  const rule = await installKazumiRule(name);
  return jsonResponse({ ok: true, rule, sources: listKazumiSources() });
}

async function handleKazumiImport(request) {
  const payload = await request.json().catch(() => ({}));
  await ensureKazumiReady();
  const rule = await importKazumiRule(payload);
  return jsonResponse({ ok: true, rule, sources: listKazumiSources() });
}

async function handleKazumiUninstall(url) {
  const name = String(url.searchParams.get("name") || "").trim();
  if (!name) return jsonResponse({ error: "Missing rule name" }, 400);
  await ensureKazumiReady();
  uninstallKazumiRule(name);
  return jsonResponse({ ok: true, sources: listKazumiSources() });
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("检测超时")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function probeSourceHealth(sourceId) {
  return withTimeout(
    (async () => {
      const kazumiName = parseKazumiSourceId(sourceId);
      if (kazumiName) {
        await ensureKazumiReady();
        if (!getKazumiRule(kazumiName)) throw new Error("规则未安装");
        const list = await searchKazumi(kazumiName, HEALTH_QUERY);
        return Array.isArray(list) && list.length > 0;
      }

      const source = watchSources[sourceId];
      if (!source) throw new Error("未知片源");

      const list =
        source.type === "tokuzilla"
          ? await searchTokuzilla("kamen rider")
          : await searchMaccms(sourceId, HEALTH_QUERY);

      return Array.isArray(list) && list.length > 0;
    })(),
    HEALTH_TIMEOUT_MS
  );
}

const healthMonitor = createHealthMonitor(probeSourceHealth);

async function handleSourceHealth(url) {
  const source = String(url.searchParams.get("source") || "").trim();
  if (!source) return jsonResponse({ error: "Missing source" }, 400);
  return jsonResponse(await healthMonitor.check(source, { force: url.searchParams.get("force") === "1" }));
}

async function handleSourcesHealth(url) {
  await ensureKazumiReady().catch(() => {});
  const ids = Object.entries(watchSources).filter(([, source]) => source.kind === "online").map(([id]) => id);
  ids.push(...listKazumiSources().map(item => item.id));
  return jsonResponse({ list: await healthMonitor.checkAll(ids, { force: url?.searchParams.get("force") === "1" }) });
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
        mobileHint: "安卓独立版：不依赖电脑，内置片源与 Kazumi 规则可在手机本地使用。",
      });
    }

    if (path === "/api/bangumi/calendar") return handleBangumiCalendar();
    if (path === "/api/tokuzilla/latest") {
      return jsonResponse({ error: "特摄分区已移除" }, 410);
    }
    if (path === "/api/source-search") return handleSourceSearch(url);
    if (path === "/api/source-detail") return handleSourceDetail(url);
    if (path === "/api/source-play") return handleSourcePlay(url);
    if (path === "/api/watch-history") return handleWatchHistory(request);

    if (path === "/api/kazumi/repo") return handleKazumiRepo();
    if (path === "/api/kazumi/seed") return handleKazumiSeed();
    if (path === "/api/kazumi/installed") return handleKazumiInstalled();
    if (path === "/api/kazumi/sources") return handleKazumiSources();
    if (path === "/api/kazumi/install") return handleKazumiInstall(url);
    if (path === "/api/kazumi/import") return handleKazumiImport(request);
    if (path === "/api/kazumi/uninstall") return handleKazumiUninstall(url);

    if (path === "/api/sources-health") return handleSourcesHealth(url);
    if (path === "/api/source-health") return handleSourceHealth(url);
    if (path === "/api/server-qr") {
      return jsonResponse({ error: "安卓独立版无需局域网二维码" }, 404);
    }
    if (path === "/api/media-proxy") {
      const target = url.searchParams.get("url");
      if (!target) return jsonResponse({ error: "Missing url" }, 400);
      return Response.redirect(target, 302);
    }

    return jsonResponse({ error: `Unsupported native API: ${path}` }, 404);
  } catch (error) {
    return jsonResponse({ error: String(error?.message || error) }, 502);
  }
}
