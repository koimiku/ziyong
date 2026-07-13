import { setAppView } from "../app-nav.js";
import { closeSearchDialog } from "../search-dialog.js";
import { goToExplore } from "../explore-nav.js";
import { exitWatchMode } from "../watch.js";
import { appShell } from "../dom.js";
import { isAndroidStandalone } from "./install.js";

let installed = false;

export function initializeAndroidBackButton() {
  if (!isAndroidStandalone() || installed) return;
  installed = true;

  import("@capacitor/app")
    .then(({ App }) => {
      App.addListener("backButton", () => {
        handleAndroidBack(App);
      });
    })
    .catch((error) => {
      installed = false;
      console.warn("Android back button setup failed:", error);
    });
}

function handleAndroidBack(App) {
  if (document.body.classList.contains("app-update-open")) {
    document.querySelector("#appUpdateBackdrop")?.classList.remove("is-open");
    document.querySelector("#appUpdateDialog")?.classList.remove("is-open");
    document.body.classList.remove("app-update-open");
    return;
  }

  if (document.body.classList.contains("mobile-drawer-open")) {
    document.body.classList.remove("mobile-drawer-open");
    return;
  }

  if (document.body.classList.contains("search-focused")) {
    closeSearchDialog();
    return;
  }

  if (appShell?.classList.contains("is-watching") || document.body.classList.contains("mobile-watching")) {
    exitWatchMode();
    return;
  }

  if (
    document.body.classList.contains("is-searching") ||
    document.body.classList.contains("is-browsing-hero")
  ) {
    goToExplore();
    return;
  }

  if (
    document.body.classList.contains("mobile-sources-mode") ||
    document.body.classList.contains("mobile-settings-mode")
  ) {
    setAppView("explore");
    return;
  }

  App.exitApp();
}
