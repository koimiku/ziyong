import { fallbackAnime } from "./config.js";
import {
  decorateAnime,
  fetchAnimeSearch,
  formatScore,
  getPosterUrl,
  getQueryCandidates,
  matchesTypeFilter,
  matchesYearFilter,
  mergeAnimeResults,
} from "./bangumi.js";
import { refreshMediaRows } from "./media-rows.js";
import { setSearchMode, syncExplorePanels } from "./app-nav.js";
import { isTokusatsuMode } from "./content-mode.js";
import { loadCalendarFeed, renderCalendarSection } from "./calendar.js";
import {
  fetchTokuzillaLatestFeed,
  isTokusatsuItem,
  searchTokuzillaCatalog,
} from "./tokusatsu.js";
import {
  cardTemplate,
  continueCount,
  continueRow,
  heroCardTemplate,
  heroCount,
  heroMoreButton,
  heroRow,
  pageTitle,
  recommendCount,
  recommendGrid,
  resultsGrid,
  searchResultCount,
} from "./dom.js";
import { state } from "./state.js";
import { pickDisplayTitle } from "./utils.js";
import { getWatchHistoryForCurrentMode, getProgressPercent, formatProgressLabel, resolveHistoryItems } from "./watch-history.js";
import { showDetails } from "./watch.js";

const HERO_PREVIEW = 3;

function getHeroSource(items) {
  const ranked = rankItems(items);
  const heroPool = ranked.filter((item) => Number(item.score || 0) > 0);
  return heroPool.length ? heroPool : ranked;
}

export function openHeroBrowse() {
  state.browseMode = "hero";
  pageTitle.textContent = isTokusatsuMode() ? "最新更新" : "最高热度";
  updateSearchChrome();
  renderResults();
  scrollMainStageToTop();
}

let heroMoreBound = false;

export function clearSearch() {
  state.query = "";
  state.browseMode = null;
  const input = document.querySelector("#searchInput");
  if (input) input.value = "";
  document.querySelector("#searchClear")?.toggleAttribute("hidden", true);
  document.querySelector("#searchSuggest")?.setAttribute("hidden", "");
  const status = document.querySelector("#statusLine");
  if (status) {
    status.textContent = isTokusatsuMode()
      ? "浏览 Tokuzilla 最新特摄，或搜索假面骑士、战队、奥特曼..."
      : "浏览热门番剧，或搜索你想看的内容。";
  }
  updateSearchChrome();
  renderResults();
}

export function updateSearchChrome() {
  const showBack = Boolean(state.query) || state.browseMode === "hero";
  document.querySelector("#backToExplore")?.toggleAttribute("hidden", !showBack);
  document.querySelector("#searchBackButton")?.toggleAttribute("hidden", !showBack);
  document.querySelector("#mobileBackButton")?.toggleAttribute("hidden", !showBack);
}

const EXPLORE_QUERIES = [
  "鬼灭之刃",
  "进击的巨人",
  "咒术回战",
  "间谍过家家",
  "孤独摇滚",
  "辉夜大小姐",
  "更衣人偶坠入爱河",
  "命运石之门",
  "紫罗兰永恒花园",
  "你的名字",
  "千与千寻",
  "冰菓",
  "四月是你的谎言",
  "中二病也要谈恋爱",
  "关于我转生变成史莱姆这档事",
  "迷宫饭",
  "我推的孩子",
  "芙莉莲",
  "药屋少女的呢喃",
  "无职转生",
];


export async function loadTokusatsuFeed() {
  if (state.query) return;

  try {
    state.exploreItems = await fetchTokuzillaLatestFeed();
    if (!state.query && isTokusatsuMode()) renderResults();
  } catch (error) {
    console.warn(error);
  }
}

export async function loadExploreFeed() {
  if (state.query || isTokusatsuMode()) return;

  try {
    const payloads = await Promise.all(
      EXPLORE_QUERIES.map((query) => fetchAnimeSearch(query).catch(() => []))
    );
    state.exploreItems = mergeAnimeResults(
      [...state.exploreItems, ...payloads.flat()],
      ""
    );
    if (!state.query) renderResults();
  } catch (error) {
    console.warn(error);
  }
}

export async function runSearch(query) {
  state.query = query;
  state.browseMode = null;
  const input = document.querySelector("#searchInput");
  if (input && input.value.trim() !== query) input.value = query;
  document.querySelector("#searchClear")?.toggleAttribute("hidden", !query);
  pageTitle.textContent = isTokusatsuMode() ? `搜索：${query}` : `搜索：${query}`;
  updateSearchChrome();
  syncExplorePanelsForSearch();
  document.querySelector("#statusLine").textContent = isTokusatsuMode()
    ? "正在搜索 Tokuzilla 特摄库..."
    : "正在联网搜索并匹配名字...";
  resultsGrid.setAttribute("aria-busy", "true");
  setSearchMode(true);

  try {
    if (isTokusatsuMode()) {
      const items = await searchTokuzillaCatalog(query);
      state.searchItems = items;
      document.querySelector("#statusLine").textContent = items.length
        ? `在 Tokuzilla 找到 ${items.length} 个特摄条目。`
        : "Tokuzilla 暂无匹配结果。";
    } else {
      const localMatches = fallbackAnime
        .map((item) => decorateAnime(item, query))
        .filter((item) => item.matchScore >= 55)
        .sort((a, b) => b.matchScore - a.matchScore);
      const queryCandidates = getQueryCandidates(query, localMatches);
      const payloads = await Promise.all(queryCandidates.map(fetchAnimeSearch));
      const items = mergeAnimeResults([...payloads.flat(), ...localMatches], query);
      state.searchItems = items.length
        ? items
        : fallbackAnime.map((item) => decorateAnime(item, query));
      document.querySelector("#statusLine").textContent = items.length
        ? `找到 ${items.length} 个结果，已按名称相似度整理。`
        : "没有找到完全匹配，先显示热门示例。";
    }
  } catch (error) {
    console.warn(error);
    state.searchItems = isTokusatsuMode()
      ? []
      : fallbackAnime.map((item) => decorateAnime(item, query));
    document.querySelector("#statusLine").textContent = isTokusatsuMode()
      ? "Tokuzilla 搜索暂时不可用，请稍后再试。"
      : "联网搜索暂时不可用，已显示本地示例。稍后可以再试一次。";
  } finally {
    resultsGrid.removeAttribute("aria-busy");
    renderResults();
  }
}

export function renderResults() {
  const visibleItems = getVisibleItems();
  const searching = Boolean(state.query);

  if (state.browseMode === "hero" && !searching) {
    renderHeroBrowse(visibleItems);
    return;
  }

  if (!searching) {
    pageTitle.textContent = isTokusatsuMode() ? "特摄" : "探索";
    renderDashboard(visibleItems);
    return;
  }

  setSearchMode(true);
  renderSearchGrid(visibleItems);
}

function renderDashboard(items) {
  document.body.classList.remove("is-browsing-hero", "is-searching");
  resultsGrid.innerHTML = "";
  heroRow.innerHTML = "";
  continueRow.innerHTML = "";
  recommendGrid.innerHTML = "";
  document.querySelector("#resultsView")?.setAttribute("hidden", "");
  document.querySelector("#dashboardView")?.removeAttribute("hidden");

  bindHeroMoreButton();

  if (!items.length) {
    heroCount.textContent = isTokusatsuMode() ? "Tokuzilla" : "暂无内容";
    continueCount.textContent = "";
    recommendCount.textContent = "";
    recommendGrid.innerHTML = `<div class="empty-state inline-empty"><p>没有符合筛选的结果</p></div>`;
    heroMoreButton.hidden = true;
    if (isTokusatsuMode()) {
      document.querySelector("#calendarSection")?.setAttribute("hidden", "");
    } else {
      renderCalendarSection();
    }
    syncExplorePanels();
    return;
  }

  const ranked = rankItems(items);
  const heroSource = getHeroSource(items);
  const heroItems = heroSource.slice(0, HERO_PREVIEW);

  const continueItems = resolveHistoryItems(
    getWatchHistoryForCurrentMode(),
    state.exploreItems
  );
  const usedIds = new Set([
    ...heroItems.map((item) => item.id),
    ...continueItems.map((item) => item.id),
  ]);
  const recommendItems = ranked.filter((item) => !usedIds.has(item.id));

  heroItems.forEach((item) => heroRow.append(createHeroCard(item)));
  continueItems.forEach((item) => continueRow.append(createPortraitCard(item, { continue: true })));
  recommendItems.forEach((item) => recommendGrid.append(createPortraitCard(item)));

  heroCount.textContent = isTokusatsuMode()
    ? `Tokuzilla 最新 · 共 ${heroSource.length} 部`
    : `Bangumi 高分 · 共 ${heroSource.length} 部`;

  if (continueItems.length) {
    continueCount.textContent = `${continueItems.length} 部最近观看`;
    document.querySelector("#continueSection")?.removeAttribute("hidden");
  } else {
    continueCount.textContent = "还没有记录";
    continueRow.innerHTML = `<p class="inline-empty">${
      isTokusatsuMode()
        ? "点进特摄开始观看后，会出现在这里。"
        : "点进番剧开始观看后，会出现在这里。"
    }</p>`;
  }

  recommendCount.textContent = isTokusatsuMode()
    ? `${recommendItems.length} 部特摄`
    : `${recommendItems.length} 部番剧`;
  updateHeroMoreButton(heroSource.length);
  if (isTokusatsuMode()) {
    document.querySelector("#calendarSection")?.setAttribute("hidden", "");
  } else {
    renderCalendarSection();
  }
  refreshMediaRows();
  syncExplorePanels();
}

function bindHeroMoreButton() {
  if (heroMoreBound || !heroMoreButton) return;
  heroMoreButton.addEventListener("click", () => {
    openHeroBrowse();
  });
  heroMoreBound = true;
}

function updateHeroMoreButton(total) {
  if (!heroMoreButton) return;
  heroMoreButton.hidden = total <= HERO_PREVIEW;
  heroMoreButton.textContent = "更多";
}

function renderHeroBrowse(items) {
  const heroSource = getHeroSource(items);

  heroRow && (heroRow.innerHTML = "");
  continueRow && (continueRow.innerHTML = "");
  recommendGrid && (recommendGrid.innerHTML = "");
  resultsGrid.innerHTML = "";
  document.querySelector("#dashboardView")?.setAttribute("hidden", "");
  document.querySelector("#resultsView")?.removeAttribute("hidden");
  document.querySelector("#miruView")?.setAttribute("hidden", "");
  document.querySelector("#settingsView")?.setAttribute("hidden", "");
  document.body.classList.remove("is-searching");
  document.body.classList.add("is-browsing-hero");
  syncExplorePanels();
  pageTitle.textContent = isTokusatsuMode() ? "最新更新" : "最高热度";
  updateSearchChrome();

  if (!heroSource.length) {
    searchResultCount.textContent = "暂无内容";
    resultsGrid.innerHTML = `
      <div class="empty-state">
        <h2>没有符合筛选的结果</h2>
        <p>换一个类型或年份筛选试试。</p>
      </div>
    `;
    return;
  }

  searchResultCount.textContent = isTokusatsuMode()
    ? `共 ${heroSource.length} 部 · 按年份排序，向下滚动浏览`
    : `共 ${heroSource.length} 部 · 按评分排序，向下滚动浏览`;
  heroSource.forEach((item) => {
    resultsGrid.append(createPortraitCard(item));
  });
  syncExplorePanels();
}

function scrollMainStageToTop() {
  document.querySelector(".main-stage")?.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSearchGrid(visibleItems) {
  document.body.classList.remove("is-browsing-hero");
  heroRow && (heroRow.innerHTML = "");
  continueRow && (continueRow.innerHTML = "");
  recommendGrid && (recommendGrid.innerHTML = "");
  resultsGrid.innerHTML = "";
  document.querySelector("#dashboardView")?.setAttribute("hidden", "");
  document.querySelector("#resultsView")?.removeAttribute("hidden");

  if (!visibleItems.length) {
    searchResultCount.textContent = "已显示 0 个结果";
    resultsGrid.innerHTML = `
      <div class="empty-state">
        <h2>没有符合筛选的结果</h2>
        <p>换一个类型或重新搜索试试。</p>
      </div>
    `;
    return;
  }

  searchResultCount.textContent = `已显示 ${visibleItems.length} 个结果`;
  visibleItems.forEach((item) => {
    resultsGrid.append(createPortraitCard(item));
  });
  syncExplorePanels();
}

function createPortraitCard(item, options = {}) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  fillCard(card, item);

  const progress = getProgressPercent(item);
  const progressLabel = formatProgressLabel(item);
  if (options.continue && progress > 0) {
    card.classList.add("has-progress");
    const footer = card.querySelector(".card-footer");
    if (footer) {
      const bar = document.createElement("div");
      bar.className = "card-progress";
      bar.innerHTML = `<span style="width:${progress}%"></span>`;
      footer.prepend(bar);
    }
    if (progressLabel) {
      const note = document.createElement("p");
      note.className = "continue-label";
      note.textContent = progressLabel;
      card.querySelector(".card-body")?.append(note);
    }
  }

  const openDetails = () => {
    if (options.continue && item.progress) {
      showDetails(item, { resume: item.progress });
      return;
    }
    showDetails(item);
  };

  card.querySelector(".card-play, button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    openDetails();
  });
  card.addEventListener("click", openDetails);
  return card;
}

function createHeroCard(item) {
  const card = heroCardTemplate.content.firstElementChild.cloneNode(true);
  fillCard(card, item);
  card.querySelector(".card-play, .hero-play")?.addEventListener("click", (event) => {
    event.stopPropagation();
    showDetails(item);
  });
  card.addEventListener("click", () => showDetails(item));
  return card;
}

function fillCard(card, item) {
  const tokusatsu = isTokusatsuItem(item);
  const title = pickDisplayTitle(item);
  const image = card.querySelector(".poster");
  image.src = getPosterUrl(item);
  image.alt = `${title} 海报`;
  image.loading = "lazy";
  image.decoding = "async";
  card.querySelector(".type").textContent = item.displayType || (tokusatsu ? "特摄" : "动画");
  const yearEl = card.querySelector(".year");
  if (yearEl) yearEl.textContent = item.year || (tokusatsu ? "" : "年份未知");
  card.querySelector("h3").textContent = title;
  const synonyms = card.querySelector(".synonyms");
  if (synonyms) {
    synonyms.textContent = tokusatsu ? "" : item.aliases.slice(1, 3).join(" / ");
  }
  card.querySelector(".score").textContent = tokusatsu ? "Tokuzilla" : formatScore(item);
}

function syncExplorePanelsForSearch() {
  document.querySelector("#miruView")?.setAttribute("hidden", "");
  document.querySelector("#settingsView")?.setAttribute("hidden", "");
  document.querySelectorAll("[data-nav-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.navView === "explore");
  });
}

function rankItems(items) {
  return [...items].sort((a, b) => {
    if (isTokusatsuMode()) {
      return Number(b.year || 0) - Number(a.year || 0);
    }
    if (state.sort === "year") return Number(b.year || 0) - Number(a.year || 0);
    if (state.sort === "match") return Number(b.matchScore || 0) - Number(a.matchScore || 0);
    return Number(b.score || 0) - Number(a.score || 0);
  });
}

function getCatalogItems() {
  const items = state.query ? state.searchItems : state.exploreItems;
  return items.filter((item) =>
    isTokusatsuMode() ? isTokusatsuItem(item) : !isTokusatsuItem(item)
  );
}

function getVisibleItems() {
  return getCatalogItems()
    .filter((item) => matchesTypeFilter(item, state.type))
    .filter((item) => matchesYearFilter(item, state.yearFilter));
}
