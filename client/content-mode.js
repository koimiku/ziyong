import { state } from "./state.js";
import { goToExplore } from "./explore-nav.js";

const STORAGE_KEY = "anime-content-mode";

export function getContentMode() {
  return state.contentMode === "tokusatsu" ? "tokusatsu" : "anime";
}

export function isTokusatsuMode() {
  return getContentMode() === "tokusatsu";
}

export function initializeContentMode() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "tokusatsu" || saved === "anime") {
    state.contentMode = saved;
  }

  applyContentModeUi();
  bindContentModeToggle();
}

export function setContentMode(mode, options = {}) {
  const nextMode = mode === "tokusatsu" ? "tokusatsu" : "anime";
  if (nextMode === getContentMode() && !options.force) return;

  state.contentMode = nextMode;
  localStorage.setItem(STORAGE_KEY, nextMode);

  state.query = "";
  state.browseMode = null;
  state.searchItems = [];
  state.exploreItems = [];

  import("./watch.js").then(({ exitWatchMode }) => exitWatchMode());
  import("./miru-ui.js").then(({ reloadMiruPanel }) => {
    reloadMiruPanel().catch((error) => console.warn(error));
  });

  applyContentModeUi();

  import("./results.js").then(({ loadTokusatsuFeed, loadExploreFeed, clearSearch, renderResults }) => {
    if (!options.skipNavReset) {
      goToExplore();
      clearSearch();
    }

    if (nextMode === "tokusatsu") {
      loadTokusatsuFeed()
        .then(() => renderResults())
        .catch((error) => console.warn(error));
    } else {
      loadExploreFeed()
        .then(() => renderResults())
        .catch((error) => console.warn(error));
    }
  });

}

function bindContentModeToggle() {
  const handler = (event) => {
    const button = event.target.closest("[data-content-mode]");
    if (!button) return;
    setContentMode(button.dataset.contentMode);
  };

  document.querySelector("#contentModeToggle")?.addEventListener("click", handler);
  document.querySelector("#mobileContentModeToggle")?.addEventListener("click", handler);
}

function applyContentModeUi() {
  const mode = getContentMode();
  document.body.classList.toggle("content-tokusatsu", mode === "tokusatsu");
  document.body.classList.toggle("content-anime", mode === "anime");

  document.querySelectorAll("[data-content-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.contentMode === mode);
  });

  const eyebrow = document.querySelector(".stage-header-main .eyebrow");
  if (eyebrow) {
    eyebrow.textContent = mode === "tokusatsu" ? "TOKUSATSU" : "ANIME";
  }

  const pageTitle = document.querySelector("#pageTitle");
  if (pageTitle && !state.query && state.browseMode !== "hero") {
    pageTitle.textContent = mode === "tokusatsu" ? "特摄" : "探索";
  }

  const statusLine = document.querySelector("#statusLine");
  if (statusLine && !state.query) {
    statusLine.textContent =
      mode === "tokusatsu"
        ? "浏览 Tokuzilla 最新特摄，或搜索假面骑士、战队、奥特曼..."
        : "浏览热门番剧，或搜索你想看的内容。";
  }

  const searchInput = document.querySelector("#searchInput");
  if (searchInput) {
    searchInput.placeholder =
      mode === "tokusatsu" ? "搜索特摄名、英文名..." : "搜索番剧名、别名...";
  }

  document.querySelector(".explore-filters")?.toggleAttribute("hidden", mode === "tokusatsu");
  document.querySelector("#calendarSection")?.toggleAttribute("hidden", mode === "tokusatsu");

  const heroTitle = document.querySelector("#heroSection .media-row-head h3");
  if (heroTitle) {
    heroTitle.textContent = mode === "tokusatsu" ? "最新更新" : "最高热度";
  }

  const recommendTitle = document.querySelector("#recommendSection .media-row-head h3");
  if (recommendTitle) {
    recommendTitle.textContent = mode === "tokusatsu" ? "更多特摄" : "为你推荐";
  }

  document.querySelector(".mobile-header-partition")?.classList.toggle(
    "is-tokusatsu",
    mode === "tokusatsu"
  );
}
