import { searchForm, searchInput } from "./dom.js";
import { setAppView } from "./app-nav.js";
import { fetchAnimeSearch } from "./bangumi.js";
import { isTokusatsuMode } from "./content-mode.js";
import { getPosterUrl } from "./bangumi.js";
import { runSearch } from "./results.js";
import { searchTokuzillaCatalog } from "./tokusatsu.js";
import { escapeHtml, pickDisplayTitle } from "./utils.js";
import { showDetails } from "./watch.js";

const RECENT_KEY = "anime-search-recent";
const MAX_RECENT = 8;
const MAX_SUGGEST = 8;

let suggestItems = [];
let activeIndex = -1;
let suggestRequestId = 0;
let debounceTimer = null;

export function initializeSearchDialog() {
  const clearButton = document.querySelector("#searchClear");
  const suggestEl = document.querySelector("#searchSuggest");

  const triggers = [
    document.querySelector("#headerSearchButton"),
    document.querySelector("#mobileSearchButton"),
  ].filter(Boolean);

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", () => openSearchDialog());
  });

  searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;
    commitSearch(query);
  });

  searchInput?.addEventListener("input", () => {
    syncClearButton();
    scheduleSuggest(searchInput.value.trim());
  });

  searchInput?.addEventListener("focus", () => {
    document.body.classList.add("search-focused");
    const query = searchInput.value.trim();
    if (query) scheduleSuggest(query);
    else renderSuggestPanel([], getRecentSearches());
  });

  searchInput?.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (document.activeElement === searchInput) return;
      if (suggestEl?.contains(document.activeElement)) return;
      hideSuggest();
      document.body.classList.remove("search-focused");
    }, 120);
  });

  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === "Escape") {
      hideSuggest();
      searchInput.blur();
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0 && suggestItems[activeIndex]) {
      event.preventDefault();
      chooseSuggest(suggestItems[activeIndex]);
    }
  });

  clearButton?.addEventListener("click", () => {
    searchInput.value = "";
    syncClearButton();
    searchInput.focus();
    renderSuggestPanel([], getRecentSearches());
  });

  suggestEl?.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  suggestEl?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-suggest-index]");
    if (!button) return;
    const index = Number(button.dataset.suggestIndex);
    if (!Number.isFinite(index) || !suggestItems[index]) return;
    chooseSuggest(suggestItems[index]);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearchDialog();
    }
  });

  syncClearButton();
}

export function openSearchDialog() {
  setAppView("explore");
  document.querySelector(".header-search")?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
  window.requestAnimationFrame(() => {
    searchInput?.focus();
    searchInput?.select();
    const query = searchInput?.value.trim() || "";
    if (query) scheduleSuggest(query);
    else renderSuggestPanel([], getRecentSearches());
  });
}

export function closeSearchDialog() {
  hideSuggest();
  searchInput?.blur();
  document.body.classList.remove("search-focused");
}

function commitSearch(query) {
  rememberRecent(query);
  hideSuggest();
  setAppView("explore");
  runSearch(query);
  searchInput?.blur();
}

function chooseSuggest(entry) {
  if (entry.kind === "recent" || entry.kind === "query") {
    searchInput.value = entry.title;
    syncClearButton();
    commitSearch(entry.title);
    return;
  }

  if (entry.item) {
    rememberRecent(pickDisplayTitle(entry.item));
    hideSuggest();
    searchInput.value = pickDisplayTitle(entry.item);
    syncClearButton();
    setAppView("explore");
    showDetails(entry.item);
    searchInput.blur();
  }
}

function scheduleSuggest(query) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    loadSuggestions(query).catch((error) => console.warn(error));
  }, 220);
}

async function loadSuggestions(query) {
  const requestId = ++suggestRequestId;
  const recent = getRecentSearches().filter((item) =>
    !query ? true : item.toLowerCase().includes(query.toLowerCase())
  );

  if (!query) {
    if (requestId === suggestRequestId) renderSuggestPanel([], recent);
    return;
  }

  renderSuggestPanel([], recent, { loading: true, query });

  try {
    const items = isTokusatsuMode()
      ? await searchTokuzillaCatalog(query)
      : await fetchAnimeSearch(query);
    if (requestId !== suggestRequestId) return;
    renderSuggestPanel(items.slice(0, MAX_SUGGEST), recent, { query });
  } catch (error) {
    console.warn(error);
    if (requestId !== suggestRequestId) return;
    renderSuggestPanel([], recent, { query, error: true });
  }
}

function renderSuggestPanel(items, recent = [], options = {}) {
  const suggestEl = document.querySelector("#searchSuggest");
  if (!suggestEl) return;

  const rows = [];
  recent.slice(0, 5).forEach((title) => {
    rows.push({
      kind: "recent",
      title,
      subtitle: "最近搜索",
    });
  });

  if (options.query) {
    rows.push({
      kind: "query",
      title: options.query,
      subtitle: "搜索此关键词",
    });
  }

  items.forEach((item) => {
    rows.push({
      kind: "item",
      item,
      title: pickDisplayTitle(item),
      subtitle: [item.displayType, item.year].filter(Boolean).join(" · "),
      poster: getPosterUrl(item),
    });
  });

  suggestItems = rows;
  activeIndex = -1;

  if (!rows.length && !options.loading) {
    hideSuggest();
    return;
  }

  const body = rows
    .map((row, index) => {
      const poster = row.poster
        ? `<img class="search-suggest-poster" src="${escapeHtml(row.poster)}" alt="" loading="lazy" />`
        : `<span class="search-suggest-icon" aria-hidden="true">${row.kind === "recent" ? "⏱" : "⌕"}</span>`;
      return `
        <button
          class="search-suggest-item"
          type="button"
          role="option"
          data-suggest-index="${index}"
          aria-selected="false"
        >
          ${poster}
          <span class="search-suggest-text">
            <strong>${escapeHtml(row.title)}</strong>
            <small>${escapeHtml(row.subtitle || "")}</small>
          </span>
        </button>
      `;
    })
    .join("");

  const footer = options.loading
    ? `<p class="search-suggest-status">正在联想...</p>`
    : options.error
      ? `<p class="search-suggest-status">联想暂时不可用，仍可直接搜索</p>`
      : "";

  suggestEl.innerHTML = `${body}${footer}`;
  suggestEl.hidden = false;
  searchInput?.setAttribute("aria-expanded", "true");
}

function hideSuggest() {
  const suggestEl = document.querySelector("#searchSuggest");
  if (suggestEl) {
    suggestEl.hidden = true;
    suggestEl.innerHTML = "";
  }
  suggestItems = [];
  activeIndex = -1;
  searchInput?.setAttribute("aria-expanded", "false");
}

function moveActive(delta) {
  if (!suggestItems.length) return;
  activeIndex = (activeIndex + delta + suggestItems.length) % suggestItems.length;
  document.querySelectorAll(".search-suggest-item").forEach((button, index) => {
    const active = index === activeIndex;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    if (active) button.scrollIntoView({ block: "nearest" });
  });
}

function syncClearButton() {
  const clearButton = document.querySelector("#searchClear");
  if (!clearButton || !searchInput) return;
  clearButton.hidden = !searchInput.value;
}

function getRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(Boolean).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function rememberRecent(query) {
  const next = [query, ...getRecentSearches().filter((item) => item !== query)].slice(
    0,
    MAX_RECENT
  );
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}
