import { appShell } from "./dom.js";
import { setAppView } from "./app-nav.js";
import { setThemeMode } from "./theme.js";
import { isAndroidStandalone } from "./native/install.js";

const MOBILE_QUERY = "(max-width: 780px)";
let mobileQuery = null;

export function initializeMobile() {
  mobileQuery = window.matchMedia(MOBILE_QUERY);
  applyMobileMode();
  mobileQuery.addEventListener("change", applyMobileMode);

  setupBottomNav();
  setupDrawer();
  setupMobileControls();
  loadServerInfo();

  if (isPhoneLayout()) {
    setAppView("explore");
  }
}

function isPhoneLayout() {
  return Boolean(mobileQuery?.matches || isAndroidStandalone() || document.body.classList.contains("is-android-app"));
}

function scrollMainStage(top = 0) {
  const stage = document.querySelector(".main-stage");
  if (stage) {
    stage.scrollTo({ top, behavior: "smooth" });
    return;
  }
  window.scrollTo({ top, behavior: "smooth" });
}

function applyMobileMode() {
  const mobile = isPhoneLayout();
  document.body.classList.toggle("is-mobile", mobile);
  if (!mobile) {
    appShell.classList.remove("mobile-panel-open");
    document.body.classList.remove("mobile-drawer-open", "mobile-sources-mode", "mobile-settings-mode");
    return;
  }
  setAppView(
    document.body.classList.contains("mobile-settings-mode")
      ? "settings"
      : document.body.classList.contains("mobile-sources-mode")
        ? "miru"
        : "explore"
  );
}

function setupBottomNav() {
  const nav = document.querySelector("#mobileNav");
  if (!nav) return;

  nav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mobile-tab]");
    if (!button) return;

    document.body.classList.remove("mobile-drawer-open");
    const tab = button.dataset.mobileTab;

    if (tab === "home") {
      if (
        document.body.classList.contains("is-searching") ||
        document.body.classList.contains("is-browsing-hero")
      ) {
        import("./explore-nav.js").then(({ goToExplore }) => goToExplore());
        return;
      }
      setAppView("explore");
      scrollMainStage(0);
      return;
    }

    if (tab === "miru") {
      setAppView("miru");
      scrollMainStage(0);
      return;
    }

    if (tab === "settings") {
      setAppView("settings");
      scrollMainStage(0);
    }
  });
}

function setupDrawer() {
  const openButton = document.querySelector("#mobileMenuButton");
  const closeButton = document.querySelector("#mobileDrawerClose");
  const backdrop = document.querySelector("#mobileDrawerBackdrop");

  openButton?.addEventListener("click", () => {
    document.body.classList.add("mobile-drawer-open");
  });

  closeButton?.addEventListener("click", closeDrawer);
  backdrop?.addEventListener("click", closeDrawer);
}

function setupMobileControls() {
  const desktopTypeTabs = document.querySelector("#typeTabs");
  const mobileTypeTabs = document.querySelector(".mobile-type-tabs");
  const desktopSort = document.querySelector("#sortSelect");
  const mobileSort = document.querySelector("#mobileSortSelect");
  const desktopYear = document.querySelector("#yearFilterSelect");
  const mobileYear = document.querySelector("#mobileYearSelect");
  const desktopTheme = document.querySelector("#themeSelect");
  const mobileTheme = document.querySelector("#mobileThemeSelect");

  if (mobileTypeTabs && desktopTypeTabs) {
    mobileTypeTabs.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-type]");
      if (!button) return;
      const desktopButton = desktopTypeTabs.querySelector(
        `button[data-type="${button.dataset.type}"]`
      );
      desktopButton?.click();
      mobileTypeTabs.querySelectorAll("button").forEach((tab) => {
        tab.classList.toggle("active", tab === button);
      });
      closeDrawer();
    });
  }

  mobileSort?.addEventListener("change", () => {
    if (desktopSort) {
      desktopSort.value = mobileSort.value;
      desktopSort.dispatchEvent(new Event("change"));
    }
    closeDrawer();
  });

  mobileYear?.addEventListener("change", () => {
    if (desktopYear) {
      desktopYear.value = mobileYear.value;
      desktopYear.dispatchEvent(new Event("change"));
    }
    closeDrawer();
  });

  desktopYear?.addEventListener("change", () => {
    if (mobileYear) mobileYear.value = desktopYear.value;
  });

  mobileTheme?.addEventListener("change", () => {
    setThemeMode(mobileTheme.value);
    if (desktopTheme) desktopTheme.value = mobileTheme.value;
    closeDrawer();
  });

  desktopSort?.addEventListener("change", () => {
    if (mobileSort) mobileSort.value = desktopSort.value;
  });

  desktopTheme?.addEventListener("change", () => {
    if (mobileTheme) mobileTheme.value = desktopTheme.value;
  });

  desktopTypeTabs?.addEventListener("click", () => {
    if (!mobileTypeTabs) return;
    const active = desktopTypeTabs.querySelector("button.active");
    mobileTypeTabs.querySelectorAll("button").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.type === active?.dataset.type);
    });
  });
}

function closeDrawer() {
  document.body.classList.remove("mobile-drawer-open");
}

async function loadServerInfo() {
  const hintEl = document.querySelector("#mobileServerHint");
  const settingsHint = document.querySelector("#mobileLanHint");
  if (!hintEl && !settingsHint) return;

  try {
    const response = await fetch("/api/server-info");
    if (!response.ok) return;
    const info = await response.json();
    const lanUrl = (info.urls || []).find((url) => !url.includes("127.0.0.1"));

    if (lanUrl && mobileQuery?.matches) {
      const label = lanUrl.replace("http://", "");
      if (hintEl) {
        hintEl.hidden = false;
        hintEl.innerHTML = `同 WiFi 访问 <a href="${lanUrl}">${label}</a>`;
      }
      if (settingsHint) {
        settingsHint.innerHTML = `当前服务地址：<a href="${lanUrl}">${lanUrl}</a>`;
      }
      return;
    }

    if (hintEl) hintEl.hidden = true;
    if (settingsHint) settingsHint.textContent = info.mobileHint || "";
  } catch {
    if (hintEl) hintEl.hidden = true;
    if (settingsHint) settingsHint.textContent = "";
  }
}

export function syncMobileWatchState() {
  if (!isPhoneLayout() && !window.matchMedia(MOBILE_QUERY).matches) return;
  const watching = appShell.classList.contains("is-watching");
  document.body.classList.toggle("mobile-watching", watching);
  if (watching) {
    closeDrawer();
    appShell.classList.remove("mobile-panel-open");
  }
}
