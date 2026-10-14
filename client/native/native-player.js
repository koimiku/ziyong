import { isAndroidStandalone } from "./install.js";

const COVER_CLASSES = [
  "source-sheet-open",
  "app-update-open",
  "mobile-drawer-open",
  "search-dialog-open",
  "search-focused",
];
const COVER_SELECTOR = ".kz-dialog-scrim";
const SAMPLE_POINTS = [
  [0.5, 0.5],
  [0.3, 0.5],
  [0.7, 0.5],
  [0.5, 0.25],
  [0.5, 0.75],
];
const COVER_CHECK_MS = 100;

let availability = null;
let fullscreen = false;

function plugin() {
  return window.Capacitor?.Plugins?.NativePlayer;
}

export function nativePlayerAvailable() {
  if (!isAndroidStandalone() || typeof plugin()?.load !== "function") return Promise.resolve(false);
  availability ??= plugin()
    .isAvailable()
    .then((result) => Boolean(result?.available))
    .catch(() => false);
  return availability;
}

export function exitNativeFullscreen() {
  if (!fullscreen) return false;
  fullscreen = false;
  plugin()?.setFullscreen({ value: false }).catch(() => {});
  return true;
}

// Stands in for the <video> element in player.js: the same handful of properties,
// methods and events, backed by the libmpv view the plugin lays over `frame`.
export function createNativeVideo(frame, hooks = {}) {
  const api = plugin();
  const events = new EventTarget();
  let position = 0;
  let duration = NaN;
  let paused = true;
  let handles = [];
  let raf = 0;
  let lastCoverCheck = -Infinity;
  let lastRect = "";
  let lastVisible = null;
  let coveredNow = false;

  const emit = (type) => events.dispatchEvent(new Event(type));

  function listen() {
    if (handles.length) return;
    const add = (name, handler) => handles.push(Promise.resolve(api.addListener(name, handler)));
    add("progress", (data) => {
      position = Number(data?.position) || 0;
      if (Number(data?.duration) > 0) duration = Number(data.duration);
      const wasPaused = paused;
      paused = Boolean(data?.paused);
      if (paused && !wasPaused) emit("pause");
      if (!paused && wasPaused) emit("play");
      emit("timeupdate");
    });
    add("ended", () => {
      paused = true;
      emit("ended");
    });
    add("next", () => hooks.onNext?.());
    add("back", () => hooks.onBack?.());
    add("fullscreen", (data) => {
      fullscreen = Boolean(data?.value);
    });
  }

  function unlisten() {
    handles.forEach((pending) => pending.then((handle) => handle?.remove?.()).catch(() => {}));
    handles = [];
  }

  function frameRect() {
    if (!frame.isConnected) return null;
    const css = frame.getBoundingClientRect();
    if (css.width < 2 || css.height < 2) return null;
    const ratio = window.devicePixelRatio || 1;
    return {
      css,
      x: Math.round(css.left * ratio),
      y: Math.round(css.top * ratio),
      width: Math.round(css.width * ratio),
      height: Math.round(css.height * ratio),
    };
  }

  function isCovered(css) {
    const body = document.body;
    if (COVER_CLASSES.some((name) => body.classList.contains(name))) return true;
    if (document.querySelector(COVER_SELECTOR)) return true;
    return SAMPLE_POINTS.some(([px, py]) => {
      const hit = document.elementFromPoint(css.left + css.width * px, css.top + css.height * py);
      return Boolean(hit) && !frame.contains(hit);
    });
  }

  function sync(now) {
    raf = requestAnimationFrame(sync);
    if (!frame.isConnected) {
      stop();
      return;
    }
    if (document.hidden || fullscreen) return;
    const rect = frameRect();
    if (rect) {
      const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
      if (key !== lastRect) {
        lastRect = key;
        api.setRect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch(() => {});
      }
    }
    if (now - lastCoverCheck >= COVER_CHECK_MS) {
      lastCoverCheck = now;
      coveredNow = rect ? isCovered(rect.css) : true;
    }
    const visible = Boolean(rect) && !coveredNow;
    if (visible !== lastVisible) {
      lastVisible = visible;
      api.setVisible({ visible }).catch(() => {});
    }
  }

  function startSync() {
    if (raf) return;
    lastRect = "";
    lastVisible = null;
    lastCoverCheck = -Infinity;
    raf = requestAnimationFrame(sync);
  }

  function stopSync() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function stop() {
    stopSync();
    unlisten();
    fullscreen = false;
    position = 0;
    duration = NaN;
    paused = true;
    api.stop().catch(() => {});
  }

  return {
    isNative: true,
    get currentTime() {
      return position;
    },
    set currentTime(value) {
      position = Math.max(0, Number(value) || 0);
      api.seek({ position }).catch(() => {});
    },
    get duration() {
      return duration;
    },
    get paused() {
      return paused;
    },
    play() {
      paused = false;
      return api.play().catch(() => {});
    },
    pause() {
      api.pause().catch(() => {});
    },
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
    async attach(stream, startPosition = 0, info = {}) {
      listen();
      startSync();
      position = Math.max(0, Number(startPosition) || 0);
      duration = NaN;
      paused = false;
      const headers = { ...(stream.headers || {}) };
      if (!Object.keys(headers).some((key) => key.toLowerCase() === "user-agent")) {
        headers["User-Agent"] = navigator.userAgent;
      }
      const rect = frameRect();
      const result = await api.load({
        url: new URL(stream.url, window.location.href).href,
        headers,
        position,
        title: info.title || "",
        hasNext: Boolean(info.hasNext),
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
      });
      duration = Number(result?.duration) || NaN;
      emit("loadedmetadata");
    },
    setInfo(info = {}) {
      api.setInfo({ title: info.title || "", hasNext: Boolean(info.hasNext) }).catch(() => {});
    },
    stop,
  };
}
