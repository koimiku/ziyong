import WebTorrent from "webtorrent";
import { spawn } from "node:child_process";

const MIKAN_ORIGIN = "https://mikanani.me";
const browserHeaders = {
  Accept: "application/rss+xml, application/xml, text/xml, text/html, */*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

const client = new WebTorrent({
  utp: true,
});

const torrentJobs = new Map();
let ffmpegAvailable = null;

export async function searchMikan(query) {
  const items = await fetchMikanItems(query);
  if (!items.length) return [];

  return [
    {
      id: query,
      name: `${query}（蜜柑计划）`,
      pic: "https://mikanani.me/images/mikan-pic.png",
      url: `${MIKAN_ORIGIN}/Home/Search?searchstr=${encodeURIComponent(query)}`,
    },
  ];
}

export async function detailMikan(query) {
  const items = await fetchMikanItems(query);
  const episodes = pickEpisodes(items);

  return {
    source: "mikan",
    name: "蜜柑计划",
    id: query,
    detailUrl: `${MIKAN_ORIGIN}/Home/Search?searchstr=${encodeURIComponent(query)}`,
    lines: episodes.length
      ? [
          {
            sid: 1,
            name: "蜜柑计划 BT",
            episodes,
          },
        ]
      : [],
  };
}

export async function resolveMikanPlay(torrentUrl, pageUrl) {
  if (!torrentUrl) {
    throw new Error("Missing torrent");
  }

  // Resolve metadata up front so playback can start immediately after.
  const torrent = await loadTorrent(torrentUrl);
  const file = pickVideoFile(torrent.files);
  if (!file) {
    throw new Error("该蜜柑资源里没有可识别的视频文件");
  }

  if (/\.mkv$/i.test(file.name) && !(await checkFfmpeg())) {
    throw new Error("该蜜柑资源是 MKV，浏览器无法直接播放。请安装 ffmpeg 后重启，或换在线片源");
  }

  torrent.files.forEach((item) => {
    if (item !== file) item.deselect();
  });
  file.select();

  return {
    url: `/api/mikan-stream?torrent=${encodeURIComponent(torrentUrl)}`,
    sourceUrl: torrentUrl,
    type: "file",
    proxied: true,
    pageUrl: pageUrl || torrentUrl,
    kind: "torrent",
    fileName: file.name,
  };
}

export async function handleMikanStream(url, request, response) {
  const torrentUrl = String(url.searchParams.get("torrent") || "");
  if (!torrentUrl.startsWith("https://mikanani.me/Download/")) {
    response.writeHead(400);
    response.end("Invalid torrent");
    return;
  }

  try {
    const torrent = await loadTorrent(torrentUrl);
    const file = pickVideoFile(torrent.files);
    if (!file) {
      response.writeHead(404);
      response.end("Torrent has no playable video file");
      return;
    }

    // Prioritize streaming the chosen file.
    torrent.files.forEach((item) => {
      if (item !== file) item.deselect();
    });
    file.select();

    const isMkv = /\.mkv$/i.test(file.name);
    if (isMkv) {
      const canRemux = await checkFfmpeg();
      if (!canRemux) {
        response.writeHead(415, { "Content-Type": "application/json; charset=utf-8" });
        response.end(
          JSON.stringify({
            error: "该蜜柑资源是 MKV，当前环境无法边下边播。请安装 ffmpeg 或换在线片源。",
          })
        );
        return;
      }
      await streamMkvAsMp4(file, response);
      return;
    }

    await streamFile(file, request, response);
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: String(error?.message || error) }));
    } else {
      response.destroy(error);
    }
  }
}

async function fetchMikanItems(query) {
  const rssUrl = `${MIKAN_ORIGIN}/RSS/Search?searchstr=${encodeURIComponent(query)}`;
  const response = await fetch(rssUrl, { headers: browserHeaders });
  if (!response.ok) {
    throw new Error(`Mikan search failed: ${response.status}`);
  }

  const xml = await response.text();
  const items = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const title = decodeXml(block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1]
      || block.match(/<title>(.*?)<\/title>/i)?.[1]
      || "");
    const pageUrl = decodeXml(block.match(/<link>(.*?)<\/link>/i)?.[1] || "");
    const torrentUrl = decodeXml(
      block.match(/url="(https:\/\/mikanani\.me\/Download\/[^"]+\.torrent)"/i)?.[1] || ""
    );
    const length = Number(block.match(/length="(\d+)"/i)?.[1] || 0);
    if (!title || !torrentUrl) continue;
    items.push({
      title,
      pageUrl,
      torrentUrl,
      length,
      episode: extractEpisodeNumber(title),
      score: scoreRelease(title, length),
    });
  }
  return items;
}

function pickEpisodes(items) {
  const bestByEpisode = new Map();

  items.forEach((item) => {
    if (item.episode == null) return;
    if (isBatchTitle(item.title)) return;
    const current = bestByEpisode.get(item.episode);
    if (!current || item.score > current.score) {
      bestByEpisode.set(item.episode, item);
    }
  });

  // If no numbered episodes, fall back to top playable single releases.
  if (!bestByEpisode.size) {
    return items
      .filter((item) => !isBatchTitle(item.title))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((item, index) => toEpisode(item, index + 1));
  }

  return [...bestByEpisode.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([episode, item]) => toEpisode(item, episode));
}

function toEpisode(item, episodeNumber) {
  const nid = Number(episodeNumber);
  return {
    sid: 1,
    nid,
    label: `第${String(nid).padStart(2, "0")}集`,
    pageUrl: item.pageUrl || item.torrentUrl,
    playApi: `/api/source-play?source=mikan&torrent=${encodeURIComponent(
      item.torrentUrl
    )}&page=${encodeURIComponent(item.pageUrl || "")}`,
    title: item.title,
  };
}

function extractEpisodeNumber(title) {
  const patterns = [
    /第\s*(\d{1,3})\s*[话話集]/,
    /\[\s*(\d{1,3})\s*\]/,
    /\s-\s*(\d{1,3})(?:\s*END)?(?:\s*[\[(]|$)/i,
    /\s(\d{1,3})\s*END\b/i,
    /\bE(\d{1,3})\b/i,
    /\s(\d{1,3})\s*\[/,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (value > 0 && value < 1900) return value;
  }
  return null;
}

function isBatchTitle(title) {
  return /合集|全集|BATCH|全\d+集|\d{1,3}-\d{1,3}|BDRip.*Fin/i.test(title);
}

function scoreRelease(title, length) {
  let score = 0;
  if (/1080p|1920x1080/i.test(title)) score += 50;
  if (/720p|1280x720/i.test(title)) score += 20;
  if (/\bmp4\b/i.test(title)) score += 40;
  if (/WEB|WEB-DL|WebRip/i.test(title)) score += 15;
  if (/简|CHS|GB|简中|简体/i.test(title)) score += 10;
  if (/繁|CHT|BIG5|繁中/i.test(title)) score += 6;
  if (/HEVC|H\.?265|HDR/i.test(title)) score -= 8;
  if (/mkv/i.test(title)) score -= 5;
  if (length > 0 && length < 2_000_000_000) score += 5;
  return score;
}

function loadTorrent(torrentUrl) {
  if (torrentJobs.has(torrentUrl)) {
    return torrentJobs.get(torrentUrl);
  }

  const job = new Promise((resolve, reject) => {
    let settled = false;
    const torrent = client.add(torrentUrl, {
      destroyStoreOnDestroy: true,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        torrent.destroy();
      } catch {
        // ignore
      }
      torrentJobs.delete(torrentUrl);
      reject(new Error("蜜柑资源连接超时，可能暂时没有足够做种，请换源或稍后重试"));
    }, 45000);

    torrent.on("ready", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(torrent);
    });

    torrent.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      torrentJobs.delete(torrentUrl);
      reject(error);
    });
  });

  torrentJobs.set(torrentUrl, job);
  return job;
}

function pickVideoFile(files) {
  const videos = files.filter((file) => /\.(mp4|webm|mkv|mov)$/i.test(file.name));
  if (!videos.length) return null;

  return videos.sort((a, b) => scoreVideoFile(b) - scoreVideoFile(a))[0];
}

function scoreVideoFile(file) {
  let score = Number(file.length || 0);
  if (/\.mp4$/i.test(file.name)) score += 1e15;
  if (/\.webm$/i.test(file.name)) score += 1e14;
  if (/\.mkv$/i.test(file.name)) score += 1e13;
  return score;
}

async function streamFile(file, request, response) {
  const size = file.length;
  const range = request.headers.range;
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", contentTypeForName(file.name));
  response.setHeader("Cache-Control", "no-store");

  if (range) {
    const match = String(range).match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      response.writeHead(416);
      response.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : Math.min(start + 1024 * 1024 - 1, size - 1);
    if (start >= size || end >= size) {
      response.writeHead(416, { "Content-Range": `bytes */${size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
    });
    file.createReadStream({ start, end }).pipe(response);
    return;
  }

  response.writeHead(200, { "Content-Length": size });
  file.createReadStream().pipe(response);
}

async function streamMkvAsMp4(file, response) {
  response.writeHead(200, {
    "Content-Type": "video/mp4",
    "Cache-Control": "no-store",
  });

  const ffmpeg = spawn(
    ffmpegCommand(),
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-c",
      "copy",
      "-f",
      "mp4",
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",
      "pipe:1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );

  file.createReadStream().pipe(ffmpeg.stdin);
  ffmpeg.stdout.pipe(response);

  ffmpeg.stderr.on("data", () => {
    // keep stderr flowing
  });

  ffmpeg.on("error", (error) => {
    if (!response.writableEnded) response.destroy(error);
  });
}

function contentTypeForName(name) {
  if (/\.webm$/i.test(name)) return "video/webm";
  if (/\.mp4$/i.test(name)) return "video/mp4";
  if (/\.mov$/i.test(name)) return "video/quicktime";
  return "application/octet-stream";
}

function ffmpegCommand() {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

async function checkFfmpeg() {
  if (ffmpegAvailable != null) return ffmpegAvailable;
  ffmpegAvailable = await new Promise((resolve) => {
    const child = spawn(ffmpegCommand(), ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
  return ffmpegAvailable;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
