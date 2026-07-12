import { buildStreamPayload } from "../utils.mjs";
import { miruSourceId } from "./config.mjs";
import { getMeta, getRuntime, getInstalledSources } from "./repo.mjs";

export async function searchMiru(packageName, query) {
  const runtime = requireRuntime(packageName);
  const meta = getMeta(packageName);
  const list = await runtime.search(query, 1, {});
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && (item.url != null || item.title))
    .map((item) => {
      const id = String(item.url ?? "");
      return {
        id,
        name: String(item.title || id),
        pic: item.cover || "",
        url: absolutePageUrl(meta, id),
        update: item.update || "",
      };
    });
}

export async function detailMiru(packageName, id) {
  const runtime = requireRuntime(packageName);
  const meta = getMeta(packageName);
  const detail = await runtime.detail(id);
  const episodesGroups = Array.isArray(detail?.episodes) ? detail.episodes : [];

  const lines = episodesGroups
    .map((group, groupIndex) => {
      const urls = Array.isArray(group?.urls) ? group.urls : [];
      const episodes = urls
        .map((entry, episodeIndex) => {
          const watchUrl = entry?.url;
          if (watchUrl == null || watchUrl === "") return null;
          const nid = episodeIndex + 1;
          const sid = groupIndex + 1;
          const label = String(entry.name || `第${nid}集`);
          return {
            sid,
            nid,
            label,
            pageUrl: absolutePageUrl(meta, id),
            playApi: `/api/source-play?source=${encodeURIComponent(
              miruSourceId(packageName)
            )}&id=${encodeURIComponent(id)}&watch=${encodeURIComponent(String(watchUrl))}`,
            watchUrl: String(watchUrl),
          };
        })
        .filter(Boolean);

      if (!episodes.length) return null;
      return {
        sid: groupIndex + 1,
        name: String(group.title || runtime.name || `线路${groupIndex + 1}`),
        episodes,
      };
    })
    .filter(Boolean);

  return {
    source: miruSourceId(packageName),
    name: runtime.name,
    id,
    detailUrl: absolutePageUrl(meta, id),
    kind: "online",
    title: detail?.title || "",
    cover: detail?.cover || "",
    desc: detail?.desc || "",
    lines,
  };
}

export async function resolveMiruPlay(packageName, watchUrl, pageUrl = "") {
  const runtime = requireRuntime(packageName);
  const stream = await runtime.watch(watchUrl);

  if (!stream?.url) {
    throw new Error(stream?.error || "Miru extension returned no playable URL");
  }

  const type = String(stream.type || "").toLowerCase();
  if (type === "torrent") {
    throw new Error("该 Miru 扩展返回 BT 资源，anime 暂不支持，请在 Miru 中播放或换源");
  }

  const headers = stream.headers || {};
  const payload = buildStreamPayload(stream.url, pageUrl || watchUrl, headers);

  if (type === "hls" || type === "mp4" || type === "file") {
    payload.type = type === "mp4" ? "file" : type === "file" ? "file" : type === "hls" ? "hls" : payload.type;
  }
  if (type === "mp4") {
    payload.type = "file";
  }

  return payload;
}

export function listMiruClientSources() {
  return getInstalledSources();
}

function requireRuntime(packageName) {
  const runtime = getRuntime(packageName);
  if (!runtime) {
    throw new Error(`Miru extension not installed: ${packageName}`);
  }
  return runtime;
}

function absolutePageUrl(meta, id) {
  const value = String(id || "");
  if (/^https?:\/\//i.test(value)) return value;
  const site = String(meta?.webSite || "").replace(/\/$/, "");
  if (!site) return value;
  if (value.startsWith("/")) return `${site}${value}`;
  return `${site}/${value}`;
}
