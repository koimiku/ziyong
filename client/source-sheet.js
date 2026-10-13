import { escapeAttribute, escapeHtml } from "./utils.js";
import { canVerifySite } from "./site-verify.js";

const STATE_TEXT = {
  pending: "检索中",
  ready: "",
  empty: "无结果",
  error: "失败",
  verify: "需要验证",
};

// Kazumi-style source picker: one tab per source, each with its own search results.
export function createSourceSheet({ container, keywords = [], onSelect, onRetry, onSearch, onVerify }) {
  const entries = new Map();
  let order = [];
  let activeId = null;
  let userPicked = false;

  container.insertAdjacentHTML(
    "beforeend",
    `
      <div class="source-sheet" id="sourceSheet" hidden>
        <div class="source-sheet-backdrop" data-sheet-close></div>
        <section class="source-sheet-panel" role="dialog" aria-modal="true" aria-label="选择片源">
          <header class="source-sheet-head">
            <div>
              <strong>选择片源</strong>
              <span class="source-sheet-summary" id="sourceSheetSummary"></span>
            </div>
            <button class="source-sheet-close" type="button" data-sheet-close aria-label="关闭">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>
          <div class="source-sheet-tabs" id="sourceSheetTabs" role="tablist"></div>
          <div class="source-sheet-body" id="sourceSheetBody"></div>
        </section>
      </div>
    `
  );

  const root = container.querySelector("#sourceSheet");
  const tabs = root.querySelector("#sourceSheetTabs");
  const body = root.querySelector("#sourceSheetBody");
  const summary = root.querySelector("#sourceSheetSummary");

  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-sheet-close]")) {
      close();
      return;
    }
    const tab = event.target.closest("[data-sheet-tab]");
    if (tab) {
      userPicked = true;
      setActive(tab.dataset.sheetTab);
      return;
    }
    const entry = entries.get(activeId);
    if (!entry) return;
    const result = event.target.closest("[data-match-index]");
    if (result) {
      const match = entry.matches[Number(result.dataset.matchIndex)];
      if (match) onSelect?.(entry.source, match);
      return;
    }
    if (event.target.closest("[data-sheet-retry]")) {
      onRetry?.(entry.source);
      return;
    }
    if (event.target.closest("[data-sheet-verify]")) {
      onVerify?.(entry.source, entry.verify);
      return;
    }
    const keyword = event.target.closest("[data-sheet-keyword]");
    if (keyword) onSearch?.(entry.source, keyword.dataset.sheetKeyword);
  });

  root.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-sheet-search]");
    if (!form) return;
    event.preventDefault();
    const value = form.querySelector("input")?.value.trim();
    const entry = entries.get(activeId);
    if (value && entry) onSearch?.(entry.source, value);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root.isConnected && !root.hidden) close();
  });

  function setSources(sources) {
    order = sources.map((source) => source.id);
    sources.forEach((source) => {
      entries.set(source.id, { source, state: "pending", matches: [], error: "" });
    });
    renderTabs();
    renderBody();
    renderSummary();
  }

  function update(id, patch) {
    const entry = entries.get(id);
    if (!entry) return;
    Object.assign(entry, patch);
    if (!userPicked && entry.state === "ready" && entries.get(activeId)?.state !== "ready") {
      activeId = id;
      renderTabs();
      renderBody();
    } else {
      renderTab(id);
      if (id === activeId) renderBody();
    }
    renderSummary();
  }

  function stats() {
    const list = [...entries.values()];
    return {
      total: list.length,
      done: list.filter((entry) => entry.state !== "pending").length,
      ready: list.filter((entry) => entry.state === "ready").length,
      verify: list.filter((entry) => entry.state === "verify").length,
    };
  }

  function setActive(id) {
    if (!entries.has(id)) return;
    activeId = id;
    tabs.querySelectorAll("[data-sheet-tab]").forEach((tab) => {
      const active = tab.dataset.sheetTab === id;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
      if (active) tab.scrollIntoView({ block: "nearest", inline: "center" });
    });
    renderBody();
  }

  function renderTabs() {
    if (!activeId || !entries.has(activeId)) activeId = order[0] || null;
    tabs.innerHTML = order.map((id) => renderTabHtml(entries.get(id))).join("");
  }

  function renderTab(id) {
    const current = tabs.querySelector(`[data-sheet-tab="${CSS.escape(id)}"]`);
    if (current) current.outerHTML = renderTabHtml(entries.get(id));
  }

  function renderTabHtml(entry) {
    const { source, state, matches } = entry;
    const active = source.id === activeId;
    const count = state === "ready" ? String(matches.length) : STATE_TEXT[state];
    return `
      <button class="source-sheet-tab${active ? " is-active" : ""}" type="button" role="tab"
        aria-selected="${active ? "true" : "false"}" data-sheet-tab="${escapeAttribute(source.id)}" data-state="${state}">
        <i aria-hidden="true"></i>
        <span>${escapeHtml(source.name)}</span>
        ${count ? `<em>${escapeHtml(count)}</em>` : ""}
      </button>
    `;
  }

  function renderBody() {
    const entry = entries.get(activeId);
    if (!entry) {
      body.innerHTML = `<p class="source-sheet-empty">没有可用的片源，请到「片源」页安装规则。</p>`;
      return;
    }
    const { source, state, matches, error } = entry;
    let content = "";
    if (state === "pending") {
      content = `<p class="source-sheet-status"><i class="source-sheet-spinner" aria-hidden="true"></i>正在 ${escapeHtml(source.name)} 检索…</p>`;
    } else if (state === "ready") {
      content = `
        <ul class="source-result-list">
          ${matches
            .map(
              (match, index) => `
                <li>
                  <button class="source-result" type="button" data-match-index="${index}">
                    <strong>${escapeHtml(match.name)}</strong>
                    <span>${escapeHtml(source.name)}</span>
                  </button>
                </li>
              `
            )
            .join("")}
        </ul>
      `;
    } else if (state === "verify") {
      const verifiable = canVerifySite();
      content = `
        <div class="source-sheet-status is-verify">
          <span>${escapeHtml(
            verifiable
              ? `${source.name} 要求先完成网页验证，验证后会自动重新检索`
              : `${source.name} 要求先完成网页验证，请在电脑版或安卓 App 中验证`
          )}</span>
          ${
            verifiable
              ? `<button class="small-button" type="button" data-sheet-verify>去验证</button>`
              : `<button class="ghost-button" type="button" data-sheet-retry>重试</button>`
          }
        </div>
      `;
    } else {
      const message = state === "error" ? `检索失败：${error || "未知错误"}` : `${source.name} 没有找到这部番`;
      content = `
        <div class="source-sheet-status is-${state}">
          <span>${escapeHtml(message)}</span>
          <button class="ghost-button" type="button" data-sheet-retry>重试</button>
        </div>
      `;
    }
    body.innerHTML = `${content}${state === "pending" ? "" : renderTools()}`;
  }

  function renderTools() {
    return `
      <div class="source-sheet-tools">
        <span class="source-sheet-tools-label">${entries.get(activeId)?.state === "ready" ? "不是想要的？换个名字检索" : "别名检索"}</span>
        ${
          keywords.length
            ? `<div class="source-sheet-keywords">${keywords
                .map(
                  (keyword) =>
                    `<button type="button" data-sheet-keyword="${escapeAttribute(keyword)}" title="${escapeAttribute(keyword)}">${escapeHtml(keyword)}</button>`
                )
                .join("")}</div>`
            : ""
        }
        <form class="source-sheet-search" data-sheet-search>
          <input type="search" placeholder="手动输入名称检索" aria-label="手动检索" />
          <button class="small-button" type="submit">检索</button>
        </form>
      </div>
    `;
  }

  function renderSummary() {
    const { total, done, ready, verify } = stats();
    summary.textContent =
      (done < total ? `检索中 ${done}/${total}` : `${ready} 个片源有结果`) +
      (verify ? ` · ${verify} 个需要验证` : "");
  }

  function open(preferredId) {
    if (preferredId && entries.has(preferredId)) {
      userPicked = true;
      setActive(preferredId);
    }
    root.hidden = false;
    document.body.classList.add("source-sheet-open");
    tabs.querySelector(".is-active")?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function close() {
    root.hidden = true;
    document.body.classList.remove("source-sheet-open");
  }

  return { setSources, update, open, close, stats };
}
