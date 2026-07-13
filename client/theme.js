import { themeSelect } from "./dom.js";

export function initializeTheme() {
  const savedMode =
    localStorage.getItem("anime-theme") ||
    localStorage.getItem("fanxun-theme") ||
    "light";
  themeSelect.value = savedMode;
  applyTheme(savedMode);

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", () => {
    if (themeSelect.value === "system") {
      applyTheme("system");
    }
  });
}

export function setThemeMode(mode) {
  localStorage.setItem("anime-theme", mode);
  applyTheme(mode);
}

export function applyTheme(mode) {
  const resolvedTheme =
    mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : mode === "dark"
        ? "dark"
        : "light";
  document.documentElement.dataset.theme = resolvedTheme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolvedTheme === "dark" ? "#0B0D12" : "#F3F5F8");
  document.dispatchEvent(
    new CustomEvent("anime:theme-changed", { detail: { theme: resolvedTheme } })
  );
}
