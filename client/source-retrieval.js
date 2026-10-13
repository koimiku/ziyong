import { escapeHtml } from "./utils.js";

const STATE_TEXT = {
  pending: "检索中",
  loading: "读取剧集",
  ready: "可播放",
  empty: "无结果",
  nolines: "无线路",
  error: "失败",
};

const RETRYABLE = new Set(["empty", "nolines", "error"]);

export function createRetrievalPanel({ keywords = [], onRetry, onKeyword }) {
  const rows = new Map();

  function setSources(sources) {
    sources.forEach((source) => {
      if (!rows.has(source.id)) rows.set(source.id, { source, state: "pending" });
    });
    render();
  }

  function update(sourceId, patch) {
    const row = rows.get(sourceId);
    if (!row) return;
    Object.assign(row, patch);
    if (patch.state && patch.state !== "error") row.error = patch.error || "";
    render();
  }

  function retryableSources() {
    return [...rows.values()].filter((row) => RETRYABLE.has(row.state)).map((row) => row.source);
  }

  function mountSkeleton(host) {
    host.innerHTML = `
      <div class="support-section-title">
        <strong>片源检索</strong>
        <span class="retrieval-summary"></span>
      </div>
      <ul class="retrieval-list"></ul>
      <div class="retrieval-tools">
        ${
          keywords.length
            ? `<div class="retrieval-keywords" aria-label="用别名重新检索">${keywords
                .map(
                  (keyword) =>
                    `<button class="retrieval-keyword" type="button" data-keyword="${escapeHtml(keyword)}">${escapeHtml(keyword)}</button>`
                )
                .join("")}</div>`
            : ""
        }
        <form class="retrieval-search">
          <input type="search" name="keyword" placeholder="换个名字检索没找到的片源" autocomplete="off" enterkeyhint="search" />
          <button class="small-button" type="submit">检索</button>
        </form>
      </div>
    `;
    host.onclick = (event) => {
      const retry = event.target.closest("[data-retry-source]");
      if (retry) {
        const row = rows.get(retry.dataset.retrySource);
        if (row) onRetry?.(row.source);
        return;
      }
      const keyword = event.target.closest("[data-keyword]");
      if (keyword) runKeyword(keyword.dataset.keyword);
    };
    host.onsubmit = (event) => {
      event.preventDefault();
      const input = host.querySelector("input[name=keyword]");
      runKeyword(input?.value || "");
    };
    host.dataset.ready = "1";
  }

  function runKeyword(raw) {
    const keyword = String(raw || "").trim();
    if (!keyword) return;
    const targets = retryableSources();
    if (!targets.length) return;
    onKeyword?.(targets, keyword);
  }

  function renderRow(list, row) {
    let el = list.querySelector(`[data-source-id="${CSS.escape(row.source.id)}"]`);
    if (!el) {
      el = document.createElement("li");
      el.className = "retrieval-row";
      el.dataset.sourceId = row.source.id;
      el.innerHTML = `
        <i class="retrieval-dot" aria-hidden="true"></i>
        <span class="retrieval-text">
          <strong class="retrieval-name"></strong>
          <span class="retrieval-detail"></span>
        </span>
        <span class="retrieval-state"></span>
        <button class="retrieval-retry" type="button" data-retry-source="${escapeHtml(row.source.id)}" aria-label="重试 ${escapeHtml(row.source.name)}">重试</button>
      `;
      list.append(el);
    }
    el.dataset.state = row.state;
    el.querySelector(".retrieval-name").textContent = row.source.name.replace(/ · 规则$/, "");
    el.querySelector(".retrieval-state").textContent =
      row.state === "ready" && row.episodes ? `${row.episodes} 集` : STATE_TEXT[row.state] || "";
    const detail =
      row.state === "error"
        ? row.error || "检索失败"
        : row.matchName || (row.source.kind === "torrent" ? "BT 资源" : "");
    el.querySelector(".retrieval-detail").textContent = detail;
    el.querySelector(".retrieval-retry").hidden = !RETRYABLE.has(row.state);
  }

  function render() {
    const host = document.querySelector("#sourceRetrievalPanel");
    if (!host) return;
    if (host.dataset.ready !== "1") mountSkeleton(host);
    const list = host.querySelector(".retrieval-list");
    const values = [...rows.values()];
    const ordered = list.children.length
      ? values
      : [...values].sort((a, b) => stateOrder(a.state) - stateOrder(b.state));
    ordered.forEach((row) => renderRow(list, row));

    const ready = values.filter((row) => row.state === "ready").length;
    const busy = values.filter((row) => row.state === "pending" || row.state === "loading").length;
    host.querySelector(".retrieval-summary").textContent = busy
      ? `可播放 ${ready} · 检索中 ${busy}`
      : `可播放 ${ready}/${values.length}`;
    host.querySelector(".retrieval-tools").hidden = busy === values.length || !retryableSources().length;
  }

  return { setSources, update, render };
}

function stateOrder(state) {
  return { ready: 0, loading: 1, pending: 2, nolines: 3, empty: 4, error: 5 }[state] ?? 6;
}
