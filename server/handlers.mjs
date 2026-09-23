import { createHealthMonitor } from "../client/health-monitor.js";
import { browserHeaders, watchSources } from "./config.mjs";
import { getRuntime, listInstalledMeta } from "./miru/repo.mjs";
import { getCache, setCache } from "./cache.mjs";
import { writeJson } from "./utils.mjs";
import {
  parseMaccmsLines,
  preferDirectMaccmsLines,
  resolveMaccmsStream,
  searchMaccms,
} from "./maccms.mjs";
import {
  parseXgcartoonLines,
  resolveXgcartoonStream,
  searchXgcartoon,
} from "./xgcartoon.mjs";
import { parseMiruSourceId } from "./miru/config.mjs";
import { detailMiru, resolveMiruPlay, searchMiru } from "./miru/adapter.mjs";
import { getMeta } from "./miru/repo.mjs";
import {
  detailTokuzilla,
  fetchTokuzillaLatest,
  resolveTokuzillaStream,
  searchTokuzilla,
} from "./tokuzilla.mjs";

let mikanModulePromise = null;

function loadMikanModule() {
  if (!mikanModulePromise) {
    mikanModulePromise = import("./mikan.mjs");
  }
  return mikanModulePromise;
}

export async function handleSourceSearch(url, response) {
  const sourceId = String(url.searchParams.get("source") || "");
  const query = String(url.searchParams.get("q") || "").trim();
  const miruPackage = parseMiruSourceId(sourceId);
  const source = miruPackage ? getMeta(miruPackage) : watchSources[sourceId];

  if (!source || !query) {
    writeJson(response, 400, { error: "Missing source or query" });
    return;
  }

  try {
    const list = miruPackage
      ? await searchMiru(miruPackage, query)
      : source.type === "tokuzilla"
        ? await searchTokuzilla(query)
        : source.type === "mikan"
          ? await (await loadMikanModule()).searchMikan(query)
          : source.type === "xgcartoon"
            ? await searchXgcartoon(source, query)
            : await searchMaccms(source, query);

    writeJson(response, 200, {
      source: sourceId,
      name: source.name,
      list,
    });
  } catch (error) {
    writeJson(response, 502, { error: String(error?.message || error) });
  }
}

export async function handleSourceDetail(url, response) {
  const sourceId = String(url.searchParams.get("source") || "");
  const id = String(url.searchParams.get("id") || "").trim();
  const miruPackage = parseMiruSourceId(sourceId);
  const source = miruPackage ? getMeta(miruPackage) : watchSources[sourceId];

  if (!source || !id) {
    writeJson(response, 400, { error: "Missing source or id" });
    return;
  }

  const cacheKey = `detail:${sourceId}:${id}`;
  const cached = getCache(cacheKey);
  if (cached) {
    writeJson(response, 200, cached);
    return;
  }

  try {
    let payload;
    if (miruPackage) {
      payload = await detailMiru(miruPackage, id);
    } else if (source.type === "tokuzilla") {
      payload = await detailTokuzilla(id);
    } else if (source.type === "mikan") {
      payload = await (await loadMikanModule()).detailMikan(id);
    } else {
      const upstream = await fetch(source.detailUrl(id), {
        headers: {
          ...browserHeaders,
          Referer: `${source.origin}/`,
        },
      });

      if (!upstream.ok) {
        writeJson(response, 502, { error: `Upstream failed: ${upstream.status}` });
        return;
      }

      const html = await upstream.text();
      let lines =
        source.type === "xgcartoon"
          ? parseXgcartoonLines(html, sourceId, source, id)
          : parseMaccmsLines(html, sourceId, source, id);

      if (source.type === "maccms") {
        lines = await preferDirectMaccmsLines(source, id, lines);
      }

      payload = {
        source: sourceId,
        name: source.name,
        id,
        detailUrl: source.detailUrl(id),
        kind: source.kind || "online",
        lines,
      };
    }

    setCache(cacheKey, payload);
    writeJson(response, 200, payload);
  } catch (error) {
    writeJson(response, 502, { error: String(error?.message || error) });
  }
}

export async function handleSourcePlay(url, response) {
  const sourceId = String(url.searchParams.get("source") || "");
  const id = String(url.searchParams.get("id") || "").trim();
  const miruPackage = parseMiruSourceId(sourceId);
  const source = miruPackage ? getMeta(miruPackage) : watchSources[sourceId];
  const chapter = String(url.searchParams.get("chapter") || "");
  const torrent = String(url.searchParams.get("torrent") || "");
  const page = String(url.searchParams.get("page") || "");
  const ep = String(url.searchParams.get("ep") || "");
  const watch = String(url.searchParams.get("watch") || "");
  const sid = Number(url.searchParams.get("sid") || 1);
  const nid = Number(url.searchParams.get("nid") || 1);

  if (!source) {
    writeJson(response, 400, { error: "Missing source" });
    return;
  }
  if (miruPackage && !watch) {
    writeJson(response, 400, { error: "Missing watch url" });
    return;
  }
  if (!miruPackage && source.type === "mikan" && !torrent) {
    writeJson(response, 400, { error: "Missing torrent" });
    return;
  }
  if (!miruPackage && source.type !== "mikan" && source.type !== "tokuzilla" && !id) {
    writeJson(response, 400, { error: "Missing source or id" });
    return;
  }
  if (!miruPackage && source.type === "tokuzilla" && !id) {
    writeJson(response, 400, { error: "Missing tokuzilla slug" });
    return;
  }

  const cacheKey = miruPackage
    ? `play:${sourceId}:${watch}`
    : source.type === "tokuzilla"
      ? `play:${sourceId}:${id}:${ep || 1}`
      : source.type === "mikan"
        ? `play:${sourceId}:${torrent}`
        : source.type === "xgcartoon"
          ? `play:${sourceId}:${id}:${chapter}`
          : `play:${sourceId}:${id}:${sid}:${nid}`;

  const cached = getCache(cacheKey);
  if (cached) {
    writeJson(response, 200, cached);
    return;
  }

  try {
    const stream = miruPackage
      ? await resolveMiruPlay(miruPackage, watch, page)
      : source.type === "tokuzilla"
        ? await resolveTokuzillaStream(id, ep || 1)
        : source.type === "mikan"
          ? await (await loadMikanModule()).resolveMikanPlay(torrent, page)
          : source.type === "xgcartoon"
            ? await resolveXgcartoonStream(source, id, chapter)
            : await resolveMaccmsStream(source, id, sid, nid);

    setCache(cacheKey, stream);
    writeJson(response, 200, stream);
  } catch (error) {
    writeJson(response, 502, { error: String(error?.message || error) });
  }
}

export async function handleMikanStreamRoute(url, request, response) {
  const mikan = await loadMikanModule();
  await mikan.handleMikanStream(url, request, response);
}

const HEALTH_QUERY = "海贼王";
const healthMonitor = createHealthMonitor(probeSourceHealth);

export async function handleSourceHealth(url, response) {
  const sourceId = String(url.searchParams.get("source") || "").trim();
  if (!watchSources[sourceId] && !getMeta(parseMiruSourceId(sourceId))) {
    writeJson(response, 400, { error: "未知片源" });
    return;
  }
  writeJson(response, 200, await healthMonitor.check(sourceId, { force: url.searchParams.get("force") === "1" }));
}

export async function handleTokuzillaLatest(_url, response) {
  try {
    const list = await fetchTokuzillaLatest();
    writeJson(response, 200, { list });
  } catch (error) {
    writeJson(response, 502, { error: String(error?.message || error) });
  }
}

export async function handleSourcesHealth(_url, response) {
  const builtin = Object.entries(watchSources)
    .filter(([, source]) => source.kind === "online")
    .map(([id]) => id);

  const installedMiru = listInstalledMeta()
    .filter((meta) => meta.type === "bangumi")
    .map((meta) => `miru:${meta.package}`);

  const sourceIds = [...builtin, ...installedMiru];
  const results = await healthMonitor.checkAll(sourceIds, { force: _url.searchParams.get("force") === "1" });

  writeJson(response, 200, { list: results });
}

async function probeSourceHealth(sourceId) {
  const miruPackage = parseMiruSourceId(sourceId);
  if (miruPackage) {
    if (!getRuntime(miruPackage)) {
      throw new Error("扩展未加载");
    }
    const list = await searchMiru(miruPackage, HEALTH_QUERY);
    return Array.isArray(list) && list.length > 0;
  }

  const source = watchSources[sourceId];
  if (!source) throw new Error("未知片源");
  if (source.kind === "torrent") {
    const list = await (await loadMikanModule()).searchMikan(HEALTH_QUERY);
    return Array.isArray(list) && list.length > 0;
  }

  const list =
    source.type === "tokuzilla"
      ? await searchTokuzilla("kamen rider")
      : source.type === "xgcartoon"
        ? await searchXgcartoon(source, HEALTH_QUERY)
        : source.type === "maccms"
          ? await searchMaccms(source, HEALTH_QUERY)
          : [];

  return Array.isArray(list) && list.length > 0;
}
