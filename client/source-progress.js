import { escapeHtml } from "./utils.js";

const STATE_LABELS = {
  pending: "检索中",
  found: "已找到",
  empty: "无结果",
  error: "失败",
};

export function createSourceProgress(container) {
  let total = 0;
  let done = 0;
  let found = 0;

  const isMounted = () => container?.isConnected && container.querySelector(".source-progress");

  function updateHead(title) {
    const root = container?.querySelector(".source-progress");
    if (!root) return;
    if (title) root.querySelector(".source-progress-title").textContent = title;
    root.querySelector(".source-progress-count").textContent = total
      ? `${done}/${total} · 命中 ${found}`
      : "";
    root.style.setProperty("--progress", total ? String(done / total) : "0");
  }

  function onProgress(event) {
    if (!container?.isConnected) return;
    if (event.type === "start") {
      total = event.sources.length;
      done = 0;
      found = 0;
      container.innerHTML = `
        <div class="source-progress" role="status" aria-live="polite">
          <div class="source-progress-head">
            <span class="source-progress-title">正在检索片源</span>
            <span class="source-progress-count"></span>
          </div>
          <div class="source-progress-bar" aria-hidden="true"><span></span></div>
          <ul class="source-progress-list">
            ${event.sources
              .map(
                (source, index) => `
              <li class="source-progress-chip" data-source-id="${escapeHtml(source.id)}" data-state="pending" style="--i:${Math.min(index, 16)}">
                <i aria-hidden="true"></i>
                <span class="source-progress-name">${escapeHtml(source.name || source.id)}</span>
                <span class="source-progress-state">${STATE_LABELS.pending}</span>
              </li>`
              )
              .join("")}
          </ul>
        </div>`;
      updateHead();
      return;
    }
    if (event.type !== "source" || !isMounted()) return;
    done += 1;
    if (event.state === "found") found += 1;
    const chip = container.querySelector(
      `.source-progress-chip[data-source-id="${CSS.escape(String(event.source.id))}"]`
    );
    if (chip) {
      chip.dataset.state = event.state;
      chip.querySelector(".source-progress-state").textContent =
        event.state === "found" && event.count ? `${event.count} 条` : STATE_LABELS[event.state] || "";
    }
    updateHead(done >= total ? (found ? "正在读取剧集与线路" : "没有找到可用片源") : "");
  }

  return { onProgress };
}
