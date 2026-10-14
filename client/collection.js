import { getCollection, COLLECTION_STATUSES } from "./collection-store.js";
import { getPosterUrl } from "./bangumi.js";
import { pickDisplayTitle } from "./utils.js";
import { showDetails } from "./watch.js";
import { state } from "./state.js";
export function initializeCollection() {
  const view = document.querySelector("#collectionView");
  const grid = document.querySelector("#collectionGrid");
  const tabs = document.querySelector("#collectionTabs");
  let status = "all";
  function render() {
    const items = getCollection().filter(item => (status === "all" || item.collectionStatus === status) &&
      (state.contentMode === "tokusatsu" ? item.partition === "tokusatsu" || String(item.id).startsWith("tz:") :
        item.partition !== "tokusatsu" && !String(item.id).startsWith("tz:")));
    document.querySelector("#collectionCount").textContent = items.length + " 部";
    grid.replaceChildren(...items.map(item => {
      const card = document.createElement("button");
      card.type = "button"; card.className = "anime-card collection-card";
      const img = document.createElement("img");
      img.className = "poster"; img.src = getPosterUrl(item); img.alt = pickDisplayTitle(item) + " 海报";
      img.loading = "lazy"; img.decoding = "async";
      const body = document.createElement("div"); body.className = "card-body";
      const title = document.createElement("h3"); title.textContent = pickDisplayTitle(item);
      const badge = document.createElement("span"); badge.className = "collection-status"; badge.textContent = COLLECTION_STATUSES[item.collectionStatus];
      body.append(title, badge); card.append(img, body);
      card.addEventListener("click", () => showDetails({ ...item, aliases: item.aliases || [item.title_cn, item.title].filter(Boolean) }));
      return card;
    }));
    if (!items.length) {
      const empty = document.createElement("p"); empty.className = "inline-empty";
      empty.textContent = "还没有收藏。在详情页选择“想看、在看、看过”即可加入。"; grid.append(empty);
    }
    tabs.querySelectorAll("button").forEach(button => {
      const active = button.dataset.collectionFilter === status;
      button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active));
    });
  }
  tabs.addEventListener("click", event => {
    const button = event.target.closest("[data-collection-filter]");
    if (!button) return;
    status = button.dataset.collectionFilter; render();
  });
  document.addEventListener("anime:collection-changed", () => {
    if (!view.hidden && !document.querySelector(".app-shell")?.classList.contains("is-watching")) render();
  });
  document.addEventListener("anime:watch-ended", () => { if (!view.hidden) render(); });
  new MutationObserver(() => { if (!view.hidden) render(); }).observe(view, { attributes: true, attributeFilter: ["hidden"] });
  render();
}