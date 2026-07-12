import { initializeAppUpdate } from "./client/app-update.js";
import { fallbackAnime } from "./client/config.js";
import { decorateAnime } from "./client/bangumi.js";
import {
  pageTitle,
  sortSelect,
  themeSelect,
  typeTabs,
  yearFilterSelect,
} from "./client/dom.js";
import { bindExploreNavigation } from "./client/explore-nav.js";
import { initializeContentMode, isTokusatsuMode } from "./client/content-mode.js";
import { initializeDesktopNav } from "./client/desktop-nav.js";
import { initializeMediaRows } from "./client/media-rows.js";
import { initializeLanShare } from "./client/lan-share.js";
import { initializeMobile } from "./client/mobile.js";
import { initializeMobileInstall } from "./client/mobile-install.js";
import { initializeMiruPanel } from "./client/miru-ui.js";
import { loadExploreFeed, loadTokusatsuFeed, renderResults } from "./client/results.js";
import { loadCalendarFeed } from "./client/calendar.js";
import { initializeSearchDialog } from "./client/search-dialog.js";
import { refreshWatchSources } from "./client/sources.js";
import { APP_VERSION, fetchServerInfo, hideServiceWarning, showServiceWarning } from "./client/server-api.js";
import { state } from "./client/state.js";
import { initializeTheme, setThemeMode } from "./client/theme.js";
import { initializeWindowChrome } from "./client/window-chrome.js";
import { initializeWatchHistory } from "./client/watch-history.js";
import { installNativeApi, isAndroidStandalone } from "./client/native/install.js";

installNativeApi();
if (isAndroidStandalone()) {
  document.documentElement.classList.add("is-android-app");
}

initializeWindowChrome();
initializeContentMode();
initializeWatchHistory()
  .then(() => {
    if (!state.query) renderResults();
  })
  .catch((error) => console.warn(error));

document.addEventListener("anime:history-changed", () => {
  if (!state.query && !document.body.classList.contains("is-browsing-hero")) {
    renderResults();
  }
});

if (!isTokusatsuMode()) {
  state.exploreItems = fallbackAnime.map((item) => decorateAnime(item, ""));
} else {
  state.exploreItems = [];
}

typeTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-type]");
  if (!button) return;
  state.type = button.dataset.type;
  typeTabs.querySelectorAll("button").forEach((tab) => {
    tab.classList.toggle("active", tab === button);
  });
  renderResults();
});

yearFilterSelect?.addEventListener("change", () => {
  state.yearFilter = yearFilterSelect.value;
  renderResults();
});

sortSelect.addEventListener("change", () => {
  state.sort = sortSelect.value;
  renderResults();
});

themeSelect.addEventListener("change", () => {
  setThemeMode(themeSelect.value);
});

initializeTheme();
initializeSearchDialog();
initializeMediaRows();
document.addEventListener("anime:watch-ended", () => {
  if (!state.query) renderResults();
});
renderResults();
initializeMobile();
initializeMobileInstall();
initializeAppUpdate();
initializeDesktopNav();
bindExploreNavigation();
showAppVersion();
if (!isAndroidStandalone()) {
  initializeLanShare();
}
if (isTokusatsuMode()) {
  loadTokusatsuFeed();
} else {
  loadExploreFeed();
  loadCalendarFeed().then(() => {
    if (!state.query && !state.browseMode) renderResults();
  });
}

refreshWatchSources()
  .then(() => initializeMiruPanel())
  .catch((error) => console.warn(error));

async function showAppVersion() {
  const el = document.querySelector("#appVersion");
  if (!el) return;

  const result = await fetchServerInfo();
  if (result.ok && result.data?.version) {
    hideServiceWarning();
    el.textContent = `v${result.data.version}`;
    el.hidden = false;
    return;
  }

  el.textContent = `v${APP_VERSION}`;
  el.hidden = false;
  if (result.stale) {
    showServiceWarning(result.message);
  }
}
