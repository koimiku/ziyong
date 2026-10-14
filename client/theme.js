import { themeSelect } from "./dom.js";

const PALETTES = ["blue", "pink", "purple", "green", "orange", "teal"];
function readPalette(mode) {
  let saved;
  try { saved = localStorage.getItem("anime-palette-" + mode); } catch {}
  return PALETTES.includes(saved) ? saved : mode === "dark" ? "pink" : "blue";
}

export function initializeTheme() {
  for (const mode of ["light", "dark"]) {
    const select = document.querySelector("#" + mode + "PaletteSelect");
    if (!select) continue;
    select.value = readPalette(mode);
    select.addEventListener("change", () => {
      if (!PALETTES.includes(select.value)) return;
      try { localStorage.setItem("anime-palette-" + mode, select.value); } catch {}
      applyTheme(themeSelect?.value || "light");
    });
  }
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
  document.documentElement.dataset.palette = readPalette(resolvedTheme);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--m3-surface").trim());
  document.dispatchEvent(
    new CustomEvent("anime:theme-changed", { detail: { theme: resolvedTheme } })
  );
}
