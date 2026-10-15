import { isAndroidStandalone } from "./install.js";

const COVER_CLASSES = [
  "source-sheet-open",
  "app-update-open",
  "mobile-drawer-open",
  "search-dialog-open",
  "search-focused",
];
const COVER_SELECTOR = ".kz-dialog-scrim, dialog[open]";
const SAMPLE_POINTS = [
  [0.5, 0.5],
  [0.3, 0.5],
  [0.7, 0.5],
  [0.5, 0.25],
  [0.5, 0.75],
];
const MOTION_TRACK_MS = 500;

let availability = null;
let fullscreen = false;
let controlsLocked = false;

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
  if (controlsLocked) return true;
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
  let motionUntil = 0;
  let lastRect = "";
  let lastVisible = null;
  let resizeObserver;
  let layoutObserver;
  const motionEvents = ["scroll", "resize", "transitionrun", "transitionend", "animationstart", "animationend"];

  const accentColor = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const syncTheme = () => api.setInfo({ dark: document.documentElement.dataset.theme === "dark", accent: accentColor() }).catch(() => {});

  const syncVisibility = () => {
    if (document.hidden || fullscreen) stopSync();
    else startSync();
  };

  const emit = (type) => events.dispatchEvent(new Event(type));

  function listen() {
    if (handles.length) return;
    document.addEventListener("anime:theme-changed", syncTheme);
    document.addEventListener("visibilitychange", syncVisibility);
    observeLayout();
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
    add("episode", (data) => {
      const index = Number(data?.index);
      if (Number.isInteger(index) && index >= 0) hooks.onEpisode?.(index);
    });
    add("back", () => hooks.onBack?.());
    add("lock", (data) => { controlsLocked = Boolean(data?.locked); });
    add("fullscreen", (data) => {
      fullscreen = Boolean(data?.value);
      if (!fullscreen) controlsLocked = false;
      syncVisibility();
    });
  }

  function unlisten() {
    document.removeEventListener("anime:theme-changed", syncTheme);
    document.removeEventListener("visibilitychange", syncVisibility);
    handles.forEach((pending) => pending.then((handle) => handle?.remove?.()).catch(() => {}));
    handles = [];
    unobserveLayout();
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

  // Static playback needs no WebView frame loop. Track geometry when layout
  // changes, with a short frame burst during scrolling and page animations.
  function observeLayout() {
    motionEvents.forEach(name => window.addEventListener(name, trackMotion, { capture: true, passive: true }));
    resizeObserver = new ResizeObserver(() => startSync());
    resizeObserver.observe(frame);
    if (frame.parentElement) resizeObserver.observe(frame.parentElement);
    layoutObserver = new MutationObserver(records => {
      if (records.some(record => record.type === "attributes"
        ? record.target === document.body || record.target === document.documentElement
          || record.target.contains(frame) || record.target.matches?.("dialog, .kz-dialog-scrim, .option-dropdown")
        : [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1))) startSync();
    });
    layoutObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"] });
  }

  function unobserveLayout() {
    motionEvents.forEach(name => window.removeEventListener(name, trackMotion, true));
    resizeObserver?.disconnect();
    layoutObserver?.disconnect();
  }

  function trackMotion() {
    if (document.hidden || fullscreen) return;
    motionUntil = performance.now() + MOTION_TRACK_MS;
    startSync();
  }

  function sync(now) {
    raf = 0;
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
    const visible = Boolean(rect) && !isCovered(rect.css);
    if (visible !== lastVisible) {
      lastVisible = visible;
      api.setVisible({ visible }).catch(() => {});
    }
    if (now < motionUntil) raf = requestAnimationFrame(sync);
  }

  function startSync() {
    if (raf || document.hidden || fullscreen) return;
    raf = requestAnimationFrame(sync);
  }

  function stopSync() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    motionUntil = 0;
    lastRect = "";
    lastVisible = null;
  }

  function stop() {
    stopSync();
    unlisten();
    fullscreen = false;
    controlsLocked = false;
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
        dark: document.documentElement.dataset.theme === "dark",
        accent: accentColor(),
        episodes: info.episodes || [],
        episodeIndex: info.episodeIndex || 0,
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
      });
      duration = Number(result?.duration) || NaN;
      emit("loadedmetadata");
    },
    setInfo(info = {}) {
      api.setInfo({ ...info, accent: accentColor(), dark: document.documentElement.dataset.theme === "dark", title: info.title || "", hasNext: Boolean(info.hasNext) }).catch(() => {});
    },
    stop,
  };
}
