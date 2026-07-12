import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { browserHeaders } from "./config.mjs";
import { writeJson } from "./utils.mjs";

const CALENDAR_URL = "https://api.bgm.tv/calendar";
const CALENDAR_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 35000;
const MAX_ATTEMPTS = 3;

let calendarCache = { at: 0, days: null, stale: false };
let backgroundRefreshPromise = null;

(function primeCalendarCacheFromDisk() {
  const disk = loadDiskCache();
  if (disk?.days?.length) {
    calendarCache = { at: Number(disk.savedAt || 0), days: disk.days, stale: true };
  }
})();

function calendarCachePath() {
  const root = process.env.ANIME_ROOT || process.env.FANXUN_ROOT || process.cwd();
  return join(root, "data", "bangumi-calendar.json");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadDiskCache() {
  try {
    const filePath = calendarCachePath();
    if (!existsSync(filePath)) return null;
    const payload = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(payload?.days) || !payload.days.length) return null;
    return payload;
  } catch {
    return null;
  }
}

function saveDiskCache(days) {
  try {
    const filePath = calendarCachePath();
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({
        savedAt: Date.now(),
        days,
      }),
      "utf8"
    );
  } catch (error) {
    console.warn("[calendar] disk cache write failed", error?.message || error);
  }
}

async function fetchCalendarOnce(signal) {
  const response = await fetch(CALENDAR_URL, {
    headers: {
      ...browserHeaders,
      Accept: "application/json",
      Referer: "https://bgm.tv/",
      Origin: "https://bgm.tv",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Bangumi calendar failed: ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload) || !payload.length) {
    throw new Error("Bangumi calendar returned empty data");
  }

  return payload;
}

async function fetchCalendarFromApi() {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const days = await fetchCalendarOnce(controller.signal);
      clearTimeout(timer);
      return days;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      const message = String(error?.message || error);
      const retryable =
        error?.name === "AbortError" ||
        /failed:\s(429|502|503|504)/i.test(message) ||
        /fetch failed|network|timeout|aborted/i.test(message);
      if (!retryable || attempt >= MAX_ATTEMPTS) break;
      await sleep(600 * attempt);
    }
  }

  throw lastError || new Error("Bangumi calendar unavailable");
}

function refreshCalendarInBackground() {
  if (backgroundRefreshPromise) return backgroundRefreshPromise;
  backgroundRefreshPromise = fetchBangumiCalendar({ force: true })
    .catch((error) => {
      console.warn("[calendar] background refresh failed", error?.message || error);
      return null;
    })
    .finally(() => {
      backgroundRefreshPromise = null;
    });
  return backgroundRefreshPromise;
}

export async function fetchBangumiCalendar({ force = false } = {}) {
  const now = Date.now();

  if (!force && calendarCache.days?.length) {
    if (!calendarCache.stale && now - calendarCache.at < CALENDAR_TTL_MS) {
      return {
        days: calendarCache.days,
        stale: false,
        cachedAt: calendarCache.at,
      };
    }

    refreshCalendarInBackground();
    return {
      days: calendarCache.days,
      stale: true,
      cachedAt: calendarCache.at,
    };
  }

  try {
    const days = await fetchCalendarFromApi();
    saveDiskCache(days);
    calendarCache = { at: now, days, stale: false };
    return { days, stale: false, cachedAt: now };
  } catch (error) {
    const disk = loadDiskCache();
    if (disk?.days?.length) {
      calendarCache = { at: now, days: disk.days, stale: true };
      return {
        days: disk.days,
        stale: true,
        cachedAt: disk.savedAt,
        warning: String(error?.message || error),
      };
    }

    if (calendarCache.days?.length) {
      return {
        days: calendarCache.days,
        stale: true,
        cachedAt: calendarCache.at,
        warning: String(error?.message || error),
      };
    }

    throw error;
  }
}

export async function warmupBangumiCalendar() {
  try {
    const result = await fetchBangumiCalendar({ force: true });
    console.log(
      `[calendar] warmed ${result.days?.length || 0} days${result.stale ? " (stale)" : ""}`
    );
  } catch (error) {
    console.warn("[calendar] warmup failed", error?.message || error);
  }
}

export async function handleBangumiCalendar(url, response) {
  const force = String(url.searchParams.get("refresh") || "") === "1";

  try {
    const payload = await fetchBangumiCalendar({ force });
    writeJson(response, 200, payload);
  } catch (error) {
    writeJson(response, 502, {
      error: String(error?.message || error),
      hint: "Bangumi 日历接口暂时不可用，请稍后重试。",
    });
  }
}
