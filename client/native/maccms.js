import {
  browserHeaders,
  decodeHtml,
  decodePlayerUrl,
  extractPlayerAaaa,
  nativeFetch,
  watchSources,
} from "./shared.js";

function parseMaccmsLines(html, sourceId, source, id) {
  const lineNames = [
    ...html.matchAll(/swiper-slide[^>]*>[\s\S]*?&nbsp;([^<]+)<span class="badge">(\d+)/gi),
  ].map((match) => ({
    name: decodeHtml(match[1].trim()),
    count: Number(match[2]),
  }));

  const boxes = [
    ...html.matchAll(
      /<div class="anthology-list-box[^"]*"[^>]*>[\s\S]*?<ul class="anthology-list-play[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi
    ),
  ];

  const chunks = boxes.map((box) => box[1]).filter((chunk) => {
    source.episodePattern.lastIndex = 0;
    return source.episodePattern.test(chunk);
  });
  if (!chunks.length) chunks.push(html);

  const episodesBySid = new Map();

  chunks.forEach((chunk, index) => {
    source.episodePattern.lastIndex = 0;
    for (const match of chunk.matchAll(source.episodePattern)) {
      const episodeId = match[1];
      const sid = Number(match[2]);
      const nid = Number(match[3]);
      const label = decodeHtml(match[4].replace(/<[^>]+>/g, "").trim()) || `第${nid}集`;
      if (String(episodeId) !== String(id)) continue;
      if (/立即播放|播放正片|在线播放/.test(label)) continue;

      if (!episodesBySid.has(sid)) {
        episodesBySid.set(sid, {
          sid,
          name: lineNames[index]?.name || lineNames[sid - 1]?.name || `线路 ${sid}`,
          episodes: [],
        });
      }

      episodesBySid.get(sid).episodes.push({
        sid,
        nid,
        label,
        pageUrl: source.playPageUrl(id, sid, nid),
        playApi: `/api/source-play?source=${encodeURIComponent(sourceId)}&id=${encodeURIComponent(id)}&sid=${sid}&nid=${nid}`,
      });
    }
  });

  return [...episodesBySid.values()]
    .map((line) => ({
      ...line,
      episodes: line.episodes
        .sort((a, b) => a.nid - b.nid)
        .filter(
          (episode, episodeIndex, list) =>
            list.findIndex((item) => item.nid === episode.nid) === episodeIndex
        ),
    }))
    .filter((line) => line.episodes.length && !/弃用|失效|下架/.test(line.name));
}

export async function searchMaccms(sourceId, query) {
  const source = watchSources[sourceId];
  if (!source) throw new Error("Unknown source");
  const upstream = await nativeFetch(source.suggestUrl(query), {
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: `${source.origin}/`,
    },
  });
  if (!upstream.ok) throw new Error(`Upstream failed: ${upstream.status}`);
  const payload = await upstream.json();
  const list = Array.isArray(payload?.list) ? payload.list : [];
  return list.map((item) => ({
    id: item.id,
    name: item.name,
    pic: item.pic || "",
    url: source.detailUrl(item.id),
  }));
}

export async function detailMaccms(sourceId, id) {
  const source = watchSources[sourceId];
  if (!source) throw new Error("Unknown source");
  const upstream = await nativeFetch(source.detailUrl(id), {
    headers: { Referer: `${source.origin}/` },
  });
  if (!upstream.ok) throw new Error(`Detail failed: ${upstream.status}`);
  const html = await upstream.text();
  return {
    source: sourceId,
    name: source.name,
    id,
    detailUrl: source.detailUrl(id),
    kind: "online",
    lines: parseMaccmsLines(html, sourceId, source, id),
  };
}

export async function playMaccms(sourceId, id, sid, nid) {
  const source = watchSources[sourceId];
  if (!source) throw new Error("Unknown source");
  const pageUrl = source.playPageUrl(id, sid, nid);
  const upstream = await nativeFetch(pageUrl, {
    headers: { Referer: `${source.origin}/` },
  });
  if (!upstream.ok) throw new Error(`Play page failed: ${upstream.status}`);
  const html = await upstream.text();
  const player = extractPlayerAaaa(html);
  if (!player?.url) throw new Error("未找到播放地址");
  const streamUrl = decodePlayerUrl(player.url, player.encrypt);
  if (!/^https?:\/\//i.test(streamUrl)) {
    throw new Error("该线路暂不支持直链，请换线路");
  }
  return {
    url: streamUrl,
    sourceUrl: streamUrl,
    type: /\.m3u8(\?|$)/i.test(streamUrl) ? "hls" : "file",
    pageUrl,
    proxied: false,
  };
}
