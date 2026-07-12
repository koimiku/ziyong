import { browserHeaders, refererByHost } from "./config.mjs";
import { getCache, setCache } from "./cache.mjs";
import {
  buildStreamPayload,
  decodeHtml,
  decodePlayerUrl,
  extractPlayerAaaa,
} from "./utils.mjs";

export async function searchMaccms(source, query) {
  const upstream = await fetch(source.suggestUrl(query), {
    headers: {
      ...browserHeaders,
      Accept: "application/json, text/plain, */*",
      Referer: `${source.origin}/`,
    },
  });

  if (!upstream.ok) {
    throw new Error(`Upstream failed: ${upstream.status}`);
  }

  const payload = await upstream.json();
  const list = Array.isArray(payload?.list) ? payload.list : [];
  return list.map((item) => ({
    id: item.id,
    name: item.name,
    pic: item.pic || "",
    url: source.detailUrl(item.id),
  }));
}

export function parseMaccmsLines(html, sourceId, source, id) {
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

export async function preferDirectMaccmsLines(source, id, lines) {
  const probed = await Promise.all(
    lines.map(async (line) => {
      const episode = line.episodes[0];
      if (!episode) {
        return { ...line, direct: false, rank: 0 };
      }

      try {
        const pageUrl = source.playPageUrl(id, line.sid, episode.nid);
        const cacheKey = `maccms-page:${pageUrl}`;
        let html = getCache(cacheKey);
        if (!html) {
          const upstream = await fetch(pageUrl, {
            headers: {
              ...browserHeaders,
              Referer: `${source.origin}/`,
            },
          });
          if (!upstream.ok) {
            return { ...line, direct: false, rank: 0 };
          }
          html = await upstream.text();
          setCache(cacheKey, html);
        }

        const player = extractPlayerAaaa(html);
        const streamUrl = decodePlayerUrl(player?.url, player?.encrypt);
        if (!/^https?:\/\//i.test(streamUrl || "")) {
          return { ...line, direct: false, rank: 0 };
        }

        const playable = await probeStreamUrl(streamUrl, source.origin);
        if (!playable) {
          return { ...line, direct: false, rank: 0 };
        }

        const isMp4 = /\.mp4(\?|$)/i.test(streamUrl);
        return {
          ...line,
          direct: true,
          rank: isMp4 ? 2 : 1,
        };
      } catch {
        return { ...line, direct: false, rank: 0 };
      }
    })
  );

  return probed
    .filter((line) => line.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .map(({ direct, rank, ...line }) => line);
}

export async function probeStreamUrl(streamUrl, referer) {
  try {
    const host = new URL(streamUrl).hostname;
    const preferredReferer =
      refererByHost.get(host) ||
      [...refererByHost.entries()].find(([item]) => host.endsWith(`.${item}`))?.[1] ||
      referer ||
      `${new URL(streamUrl).origin}/`;

    const response = await fetch(streamUrl, {
      headers: {
        ...browserHeaders,
        Referer: preferredReferer,
        Range: "bytes=0-1023",
      },
    });
    return response.ok || response.status === 206;
  } catch {
    return false;
  }
}

export async function resolveMaccmsStream(source, id, sid, nid) {
  const pageUrl = source.playPageUrl(id, sid, nid);
  const cacheKey = `maccms-page:${pageUrl}`;
  const cachedHtml = getCache(cacheKey);
  const html =
    cachedHtml ||
    (await (async () => {
      const upstream = await fetch(pageUrl, {
        headers: {
          ...browserHeaders,
          Referer: `${source.origin}/`,
        },
      });
      if (!upstream.ok) {
        throw new Error(`Play page failed: ${upstream.status}`);
      }
      const text = await upstream.text();
      setCache(cacheKey, text);
      return text;
    })());

  const player = extractPlayerAaaa(html);
  if (!player?.url) {
    throw new Error("未找到播放地址");
  }

  const streamUrl = decodePlayerUrl(player.url, player.encrypt);
  if (!/^https?:\/\//i.test(streamUrl)) {
    throw new Error("该线路使用加密播放器，暂不支持本站直链播放，请换线路或片源");
  }

  const playable = await probeStreamUrl(streamUrl, `${source.origin}/`);
  if (!playable) {
    throw new Error("该线路视频地址失效，自动尝试其他线路");
  }

  try {
    const host = new URL(streamUrl).hostname;
    if (!refererByHost.has(host)) {
      refererByHost.set(host, `${source.origin}/`);
    }
  } catch {
    // ignore
  }

  return buildStreamPayload(streamUrl, pageUrl);
}
