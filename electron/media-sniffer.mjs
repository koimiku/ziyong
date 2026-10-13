import { BrowserWindow, session } from "electron";
import { NO_REFERER } from "../server/utils.mjs";

const MEDIA_URL = /\.(m3u8|mp4|m4v|flv)(\?|#|$)/i;
const MEDIA_TYPE = /mpegurl|^video\//i;
const PAGE_TYPE = /html|json|javascript|css|^image\//i;
const DOCUMENT_TYPES = new Set(["mainFrame", "subFrame"]);
const AD_URL = /\/(ads?|adv|advert|guanggao|gg)\/|[?&](ad|ads)=/i;
const BLOCKED_TYPES = new Set(["image", "font"]);
const MAX_CONCURRENT = 2;
const MP4_GRACE_MS = 1500;

const AUTOPLAY_SCRIPT = `(() => {
  document.querySelectorAll("video").forEach((video) => {
    video.muted = true;
    try { video.play().catch(() => {}); } catch {}
  });
  const button = document.querySelector(
    ".dplayer-mobile-play, .dplayer-play-icon, .art-control-play, .vjs-big-play-button, .prism-big-play-btn, .yzmplayer-play, .xgplayer-start, .plyr__control--overlaid, [class*=play-btn], [class*=playbtn]"
  );
  if (button) button.click();
})();`;

function headerValue(headers, name) {
  const key = Object.keys(headers || {}).find((entry) => entry.toLowerCase() === name);
  const value = key ? headers[key] : "";
  return Array.isArray(value) ? value[0] : String(value || "");
}

// Loads a play page in a hidden window and captures the first real video request,
// the way Kazumi's WebView parser does, so signed or script-generated URLs work.
export function createMediaSniffer({ userAgent }) {
  const ses = session.fromPartition("persist:media-sniffer");
  ses.setUserAgent(userAgent);
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const watchers = new Map();
  const queue = [];
  let active = 0;

  ses.webRequest.onBeforeRequest((details, callback) => {
    const watcher = watchers.get(details.webContentsId);
    callback({ cancel: Boolean(watcher && BLOCKED_TYPES.has(details.resourceType)) });
  });

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const watcher = watchers.get(details.webContentsId);
    if (watcher) {
      watcher.requestHeaders.set(details.url, details.requestHeaders);
      if (watcher.requestHeaders.size > 400) {
        watcher.requestHeaders.delete(watcher.requestHeaders.keys().next().value);
      }
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const watcher = watchers.get(details.webContentsId);
    if (
      watcher &&
      details.statusCode < 400 &&
      !DOCUMENT_TYPES.has(details.resourceType) &&
      !AD_URL.test(details.url)
    ) {
      const contentType = headerValue(details.responseHeaders, "content-type");
      const urlLooksLikeMedia = MEDIA_URL.test(new URL(details.url).pathname);
      if (MEDIA_TYPE.test(contentType) || (urlLooksLikeMedia && !PAGE_TYPE.test(contentType))) {
        watcher.hit(details.url, contentType);
      }
    }
    callback({});
  });

  function sniffOnce(pageUrl, { referer, timeoutMs = 12000 } = {}) {
    return new Promise((resolve, reject) => {
      const win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 720,
        webPreferences: {
          session: ses,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
          autoplayPolicy: "no-user-gesture-required",
        },
      });
      const contents = win.webContents;
      contents.setAudioMuted(true);
      contents.setWindowOpenHandler(() => ({ action: "deny" }));

      let settled = false;
      let pendingMp4 = null;
      let mp4Timer = null;

      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(mp4Timer);
        clearInterval(kick);
        watchers.delete(contents.id);
        if (!win.isDestroyed()) win.destroy();
        if (error) reject(error);
        else resolve(value);
      };

      const capture = (url) => {
        const sent = watcher.requestHeaders.get(url) || {};
        const headers = {
          Referer: headerValue(sent, "referer") || NO_REFERER,
          "User-Agent": headerValue(sent, "user-agent") || userAgent,
        };
        const cookie = headerValue(sent, "cookie");
        const origin = headerValue(sent, "origin");
        if (cookie) headers.Cookie = cookie;
        if (origin) headers.Origin = origin;
        finish(null, { mediaUrl: url, pageUrl, headers });
      };

      const watcher = {
        requestHeaders: new Map(),
        hit(url, contentType) {
          if (settled) return;
          const isPlaylist = /mpegurl/i.test(contentType) || /\.m3u8(\?|#|$)/i.test(url);
          if (isPlaylist) {
            capture(url);
            return;
          }
          // Pre-roll ads are usually mp4; give the real HLS stream a moment to show up.
          if (!pendingMp4) {
            pendingMp4 = url;
            mp4Timer = setTimeout(() => capture(pendingMp4), MP4_GRACE_MS);
          }
        },
      };
      watchers.set(contents.id, watcher);

      const timer = setTimeout(() => {
        if (pendingMp4) capture(pendingMp4);
        else finish(new Error("网页解析超时，没有截获到视频地址"));
      }, timeoutMs);

      const kick = setInterval(() => {
        if (win.isDestroyed()) return;
        for (const frame of contents.mainFrame?.framesInSubtree || []) {
          frame.executeJavaScript(AUTOPLAY_SCRIPT).catch(() => {});
        }
      }, 1200);

      contents.on("render-process-gone", () => finish(new Error("网页解析进程异常退出")));
      win.loadURL(pageUrl, referer ? { httpReferrer: referer } : {}).catch(() => {});
    });
  }

  function pump() {
    while (active < MAX_CONCURRENT && queue.length) {
      const job = queue.shift();
      active += 1;
      sniffOnce(job.pageUrl, job.options)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  return function sniff(pageUrl, options = {}) {
    return new Promise((resolve, reject) => {
      queue.push({ pageUrl, options, resolve, reject });
      pump();
    });
  };
}
