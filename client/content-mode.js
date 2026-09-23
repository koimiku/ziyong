import { state } from "./state.js";

// Keep shared consumers compatible while retiring the old content partition.
export function getContentMode() { return "anime"; }
export function isTokusatsuMode() { return false; }
export function initializeContentMode() {
  state.contentMode = "anime";
  try { localStorage.removeItem("anime-content-mode"); } catch {}
  document.body.classList.remove("content-tokusatsu");
  document.body.classList.add("content-anime");
}
