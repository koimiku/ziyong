import { decorateAnime, getPosterUrl, normalizeBangumiCalendarItem } from "./bangumi.js";
import { calendarMeta, calendarRow, calendarTabs } from "./dom.js";
import { showDetails } from "./watch.js";
import { pickDisplayTitle } from "./utils.js";

const CALENDAR_PREVIEW = 16;
const STORAGE_KEY = "anime-calendar-cache";
const CLIENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CLIENT_ATTEMPTS = 3;

let calendarDays = [];
let activeDayIndex = 0;
let calendarStatus = "idle";
let calendarStale = false;
let calendarCachedAt = 0;

export async function loadCalendarFeed(force = false) {
  if (calendarStatus === "loading" && !force) return;

  if (!force && calendarStatus === "idle" && loadClientCache()) {
    calendarStatus = "ready";
    renderCalendarSection();
  }

  calendarStatus = "loading";
  if (!calendarDays.length) {
    renderCalendarSection();
  }

  const loaded = await fetchCalendarWithRetry(force);
  if (loaded) {
    calendarStatus = calendarDays.length ? "ready" : "empty";
  } else if (calendarDays.length) {
    calendarStatus = "ready";
    calendarStale = true;
  } else {
    calendarStatus = "error";
  }

  renderCalendarSection();
}

async function fetchCalendarWithRetry(force) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_CLIENT_ATTEMPTS; attempt += 1) {
    try {
      const url = force || attempt > 1 ? "/api/bangumi/calendar?refresh=1" : "/api/bangumi/calendar";
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || payload.hint || `calendar ${response.status}`);
      }

      applyCalendarPayload(payload);
      saveClientCache(payload);
      return true;
    } catch (error) {
      lastError = error;
      console.warn("[calendar]", error);
      if (attempt < MAX_CLIENT_ATTEMPTS) {
        await sleep(350 * attempt);
      }
    }
  }

  if (loadClientCache()) {
    calendarStale = true;
    return false;
  }

  console.warn("[calendar] all attempts failed", lastError);
  return false;
}

function applyCalendarPayload(payload) {
  calendarDays = (payload.days || [])
    .map((day) => ({
      weekday: day.weekday?.cn || day.weekday?.en || "",
      weekdayId: day.weekday?.id || 0,
      items: (day.items || [])
        .filter((item) => item.type === 2)
        .map(normalizeBangumiCalendarItem)
        .map((item) => decorateAnime(item, "")),
    }))
    .filter((day) => day.items.length);

  calendarStale = Boolean(payload.stale);
  calendarCachedAt = Number(payload.cachedAt || 0);

  const today = new Date().getDay() || 7;
  const matchIndex = calendarDays.findIndex((day) => day.weekdayId === today);
  activeDayIndex = matchIndex >= 0 ? matchIndex : 0;
}

function saveClientCache(payload) {
  if (!payload?.days?.length) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        days: payload.days,
        stale: Boolean(payload.stale),
        cachedAt: payload.cachedAt || Date.now(),
      })
    );
  } catch {
    // ignore quota errors
  }
}

function loadClientCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const payload = JSON.parse(raw);
    if (!payload?.days?.length) return false;
    if (Date.now() - Number(payload.savedAt || 0) > CLIENT_CACHE_TTL_MS * 4) {
      return false;
    }
    applyCalendarPayload(payload);
    calendarStale = true;
    calendarCachedAt = Number(payload.cachedAt || payload.savedAt || 0);
    return true;
  } catch {
    return false;
  }
}

export function renderCalendarSection() {
  const section = document.querySelector("#calendarSection");
  if (!section || !calendarRow || !calendarTabs) return;

  section.removeAttribute("hidden");

  if (calendarStatus === "loading") {
    calendarTabs.innerHTML = "";
    calendarRow.innerHTML = `<p class="inline-empty calendar-status">正在加载放送日历...</p>`;
    if (calendarMeta) calendarMeta.textContent = "Bangumi 本周更新";
    return;
  }

  if (calendarStatus === "error") {
    calendarTabs.innerHTML = "";
    calendarRow.innerHTML = `
      <div class="calendar-status">
        <p class="inline-empty">Bangumi 日历暂时连接失败，可能是网络波动或接口限流。</p>
        <button class="small-button" type="button" id="calendarRetryButton">重试</button>
      </div>
    `;
    calendarRow.querySelector("#calendarRetryButton")?.addEventListener("click", () => {
      loadCalendarFeed(true);
    });
    if (calendarMeta) calendarMeta.textContent = "暂时不可用";
    return;
  }

  if (!calendarDays.length) {
    calendarTabs.innerHTML = "";
    calendarRow.innerHTML = `
      <div class="calendar-status">
        <p class="inline-empty">暂无放送数据。</p>
        <button class="small-button" type="button" id="calendarRetryButton">刷新</button>
      </div>
    `;
    calendarRow.querySelector("#calendarRetryButton")?.addEventListener("click", () => {
      loadCalendarFeed(true);
    });
    if (calendarMeta) calendarMeta.textContent = "本周更新";
    return;
  }

  calendarTabs.innerHTML = calendarDays
    .map(
      (day, index) => `
        <button
          class="${index === activeDayIndex ? "active" : ""}"
          type="button"
          data-day-index="${index}"
        >
          ${escapeHtml(day.weekday)}
        </button>
      `
    )
    .join("");

  renderCalendarDay(activeDayIndex);
  bindCalendarTabs();
}

function bindCalendarTabs() {
  if (!calendarTabs || calendarTabs.dataset.bound) return;
  calendarTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-day-index]");
    if (!button) return;
    activeDayIndex = Number(button.dataset.dayIndex);
    calendarTabs.querySelectorAll("button").forEach((tab, index) => {
      tab.classList.toggle("active", index === activeDayIndex);
    });
    renderCalendarDay(activeDayIndex);
  });
  calendarTabs.dataset.bound = "1";
}

function renderCalendarDay(index) {
  const day = calendarDays[index];
  if (!day || !calendarRow) return;

  const weekItems = calendarDays.flatMap((entry) => entry.items);
  const thisWeekCount = new Set(weekItems.map((item) => item.id)).size;
  if (calendarMeta) {
    const staleHint = calendarStale ? ` · ${formatCachedLabel(calendarCachedAt)}` : "";
    calendarMeta.textContent = `${day.weekday} · ${day.items.length} 部更新 · 本周共 ${thisWeekCount} 部${staleHint}`;
  }

  const fragment = document.createDocumentFragment();
  day.items.slice(0, CALENDAR_PREVIEW).forEach((item) => {
    fragment.append(createCalendarCard(item, day.weekday));
  });
  calendarRow.replaceChildren(fragment);
}

function formatCachedLabel(timestamp) {
  if (!timestamp) return "缓存数据";
  const ageMinutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  if (ageMinutes < 60) return `缓存 ${ageMinutes} 分钟前`;
  const ageHours = Math.round(ageMinutes / 60);
  if (ageHours < 24) return `缓存 ${ageHours} 小时前`;
  return "缓存数据";
}

function createCalendarCard(item, weekday) {
  const card = document.createElement("article");
  card.className = "calendar-card";
  const title = pickDisplayTitle(item);
  card.innerHTML = `
    <img class="poster" src="${escapeAttr(getPosterUrl(item))}" alt="${escapeAttr(title)} 海报" loading="lazy" decoding="async" />
    <div class="calendar-card-body">
      <span class="badge calendar-weekday">${escapeHtml(weekday)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p class="calendar-air">${escapeHtml(formatAirDate(item.air_date))}</p>
    </div>
  `;
  card.addEventListener("click", () => showDetails(item));
  return card;
}

function formatAirDate(value) {
  if (!value) return "放送日待定";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()} 更新`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
