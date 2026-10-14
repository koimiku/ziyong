import { appShell } from "./dom.js";

const VIEWS = ["explore", "miru", "settings"];
const MOBILE_QUERY = "(max-width: 780px)";

function isMobileLayout() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

let currentView = "";
let enterFrame = 0;
let enterAnimation = null;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function animateViewEnter(view) {
  const selector =
    view === "miru" ? "#miruView" : view === "settings" ? "#settingsView" : "#dashboardView:not([hidden]), #resultsView:not([hidden])";
  const element = document.querySelector(selector);
  if (!element || element.hidden || typeof element.animate !== "function" || prefersReducedMotion()) return;
  enterAnimation = element.animate(
    [
      { opacity: 0, transform: "translateY(8px)" },
      { opacity: 1, transform: "none" },
    ],
    { duration: 240, easing: "cubic-bezier(.05, .7, .1, 1)" }
  );
}

export function setAppView(view) {
  if (!VIEWS.includes(view)) view = "explore";
  const changed = currentView !== "" && currentView !== view;
  currentView = view;
  if (changed) {
    cancelAnimationFrame(enterFrame);
    enterAnimation?.cancel();
    enterAnimation = null;
    enterFrame = requestAnimationFrame(() => {
      enterFrame = 0;
      if (currentView === view) animateViewEnter(view);
    });
  }

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
  // Background feed/history updates must not reveal the home page over another view.
  const outsideExplore = appShell?.classList.contains("view-miru") || appShell?.classList.contains("view-settings");
  const searching = document.body.classList.contains("is-searching");
  const browsingHero = document.body.classList.contains("is-browsing-hero");
  const showList = searching || browsingHero;

  document.querySelector("#dashboardView")?.toggleAttribute("hidden", outsideExplore || showList);
  document.querySelector("#resultsView")?.toggleAttribute("hidden", outsideExplore || !showList);
}

export function setSearchMode(active) {
  document.body.classList.toggle("is-searching", active);
  syncExplorePanels();
}
