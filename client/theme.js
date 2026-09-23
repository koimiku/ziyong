import { themeSelect } from "./dom.js";

export function initializeTheme() {
  let savedMode = "light";
  try { savedMode = localStorage.getItem("anime-theme") || localStorage.getItem("fanxun-theme") || "light"; } catch {}
  if (!["light", "dark", "system"].includes(savedMode)) savedMode = "light";
  applyTheme(savedMode);

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", () => {
    if (themeSelect?.value === "system") {
      applyTheme("system");
    }
  });
}

export function setThemeMode(mode) {
  try { localStorage.setItem("anime-theme", mode); } catch {}
  applyTheme(mode);
}

export function applyTheme(mode) {
  document.querySelectorAll("#themeSelect, #mobileThemeSelect").forEach(select => { select.value = mode; });
  const resolvedTheme =
    mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : mode === "dark"
        ? "dark"
        : "light";
  document.documentElement.dataset.theme = resolvedTheme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolvedTheme === "dark" ? "#10131E" : "#F5F6FB");
  document.dispatchEvent(
    new CustomEvent("anime:theme-changed", { detail: { theme: resolvedTheme } })
  );
}
