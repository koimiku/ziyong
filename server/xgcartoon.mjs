import { browserHeaders } from "./config.mjs";
import { buildStreamPayload, decodeHtml } from "./utils.mjs";

export async function searchXgcartoon(source, query) {
  const upstream = await fetch(source.searchUrl(query), {
    headers: {
      ...browserHeaders,
      Referer: `${source.origin}/`,
    },
  });

  if (!upstream.ok) {
    throw new Error(`Upstream failed: ${upstream.status}`);
  }

  const html = await upstream.text();
  const list = [];
  const seen = new Set();

  for (const match of html.matchAll(
    /href="\/detail\/([^"]+)"[^>]*class="topic-list-item"[\s\S]*?topic-list-item__info[\s\S]*?<div class="h3[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  )) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    list.push({
      id,
      name: decodeHtml(match[2].replace(/<[^>]+>/g, "").trim()),
      pic: `https://static-a.xgcartoon.com/cover/${id}.jpg?w=300&h=256&q=100`,
      url: source.detailUrl(id),
    });
  }

  return list.slice(0, 10);
}

export function parseXgcartoonLines(html, sourceId, source, id) {
  const episodes = [];
  const seen = new Set();

  for (const match of html.matchAll(
    /href="\/user\/page_direct\?cartoon_id=([^"&]+)&(?:amp;)?chapter_id=([^"&]+)"[^>]*title="([^"]+)"[^>]*class="[^"]*goto-chapter/gi
  )) {
    const cartoonId = match[1];
    const chapterId = match[2];
    if (cartoonId !== id || seen.has(chapterId)) continue;
    seen.add(chapterId);
    episodes.push({
      sid: 1,
      nid: episodes.length + 1,
      label: decodeHtml(match[3].trim()) || `第${episodes.length + 1}集`,
      pageUrl: source.playPageUrl(id, chapterId),
      playApi: `/api/source-play?source=${encodeURIComponent(sourceId)}&id=${encodeURIComponent(id)}&chapter=${encodeURIComponent(chapterId)}`,
    });
  }

  if (!episodes.length) return [];

  return [
    {
      sid: 1,
      name: "西瓜卡通",
      episodes,
    },
  ];
}

export async function resolveXgcartoonStream(source, id, chapterId) {
  if (!chapterId) {
    throw new Error("Missing chapter");
  }

  const pageUrl = source.playPageUrl(id, chapterId);
  const upstream = await fetch(pageUrl, {
    headers: {
      ...browserHeaders,
      Referer: `${source.origin}/`,
    },
  });

  if (!upstream.ok) {
    throw new Error(`Play page failed: ${upstream.status}`);
  }

  const html = await upstream.text();
  const vid = html.match(/pframe\.xgcartoon\.com\/player\.htm\?vid=([a-f0-9-]+)/i)?.[1];
  if (!vid) {
    throw new Error("未找到视频 ID");
  }

  const streamUrl = `https://xgct-video.bzcdn.net/${vid}/playlist.m3u8`;
  return buildStreamPayload(streamUrl, pageUrl);
}
