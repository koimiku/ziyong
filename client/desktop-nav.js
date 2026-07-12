import { goToExplore } from "./explore-nav.js";
import { openSearchDialog } from "./search-dialog.js";
import { setAppView } from "./app-nav.js";

export function initializeDesktopNav() {
  if (window.matchMedia("(max-width: 780px)").matches) return;

  const rail = document.querySelector("#iconRail");
  if (!rail) return;

  rail.addEventListener("click", (event) => {
    const button = event.target.closest("[data-nav-view]");
    if (!button) return;
    if (
      button.dataset.navView === "explore" &&
      (document.body.classList.contains("is-searching") ||
        document.body.classList.contains("is-browsing-hero"))
    ) {
      goToExplore();
      return;
    }
    setAppView(button.dataset.navView);
  });

  document.querySelector("#headerSearchButton")?.addEventListener("click", () => {
    openSearchDialog();
    setAppView("explore");
  });

  setAppView("explore");
}

export { setAppView, syncExplorePanels, setSearchMode } from "./app-nav.js";
