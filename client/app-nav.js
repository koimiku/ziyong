import { appShell } from "./dom.js";

const VIEWS = ["explore", "miru", "settings"];
const MOBILE_QUERY = "(max-width: 780px)";

function isMobileLayout() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function setAppView(view) {
  if (!VIEWS.includes(view)) view = "explore";

  document.querySelectorAll("[data-nav-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.navView === view);
  });

  document.querySelectorAll("[data-mobile-tab]").forEach((button) => {
    const tab = button.dataset.mobileTab;
    const active =
      (tab === "home" && view === "explore") ||
      (tab === "miru" && view === "miru") ||
      (tab === "settings" && view === "settings");
    button.classList.toggle("active", active);
  });

  const searching = document.body.classList.contains("is-searching");
  const browsingHero = document.body.classList.contains("is-browsing-hero");

  document.querySelector("#dashboardView")?.toggleAttribute(
    "hidden",
    view !== "explore" || searching || browsingHero
  );
  document.querySelector("#resultsView")?.toggleAttribute(
    "hidden",
    view !== "explore" || (!searching && !browsingHero)
  );
  document.querySelector("#miruView")?.toggleAttribute("hidden", view !== "miru");
  document.querySelector("#settingsView")?.toggleAttribute("hidden", view !== "settings");

  appShell?.classList.toggle("view-miru", view === "miru");
  appShell?.classList.toggle("view-settings", view === "settings");
  appShell?.classList.toggle("view-explore", view === "explore");

  if (isMobileLayout()) {
    document.body.classList.toggle("mobile-sources-mode", view === "miru");
    document.body.classList.toggle("mobile-settings-mode", view === "settings");

    const exploreChrome = view === "explore";
    document.querySelector(".stage-header")?.toggleAttribute("hidden", !exploreChrome);
    document.querySelector("#statusLine")?.toggleAttribute("hidden", !exploreChrome);
    document.querySelector(".filter-bar")?.toggleAttribute("hidden", true);
  }
}

export function syncExplorePanels() {
  const searching = document.body.classList.contains("is-searching");
  const browsingHero = document.body.classList.contains("is-browsing-hero");
  const showList = searching || browsingHero;

  document.querySelector("#dashboardView")?.toggleAttribute("hidden", showList);
  document.querySelector("#resultsView")?.toggleAttribute("hidden", !showList);
}

export function setSearchMode(active) {
  document.body.classList.toggle("is-searching", active);
  syncExplorePanels();
}
