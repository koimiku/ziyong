import { setAppView } from "./app-nav.js";
import { clearSearch } from "./results.js";
import { isTokusatsuMode } from "./content-mode.js";

export function goToExplore() {
  clearSearch();
  setAppView("explore");
  const pageTitle = document.querySelector("#pageTitle");
  if (pageTitle) {
    pageTitle.textContent = isTokusatsuMode() ? "特摄" : "探索";
  }
}

export function bindExploreNavigation() {
  const triggers = [
    document.querySelector("#homeButton"),
    document.querySelector("#backToExplore"),
    document.querySelector("#searchBackButton"),
    document.querySelector("#mobileBackButton"),
  ];

  triggers.forEach((trigger) => {
    trigger?.addEventListener("click", () => goToExplore());
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (
      !document.body.classList.contains("is-searching") &&
      !document.body.classList.contains("is-browsing-hero")
    ) {
      return;
    }
    if (document.body.classList.contains("search-focused")) return;
    if (document.body.classList.contains("lan-dialog-open")) return;
    goToExplore();
  });
}
