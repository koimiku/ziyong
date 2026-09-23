import {
  fetchMiruInstalled,
  fetchMiruRepo,
  fetchSourceHealth,
  installMiruExtension,
  refreshWatchSources,
  uninstallMiruExtension,
} from "./sources.js";
import { onlineSources } from "./config.js";
import { isTokusatsuMode } from "./content-mode.js";

const TYPE_LABELS = {
  bangumi: "在线视频",
  manga: "漫画",
  bt: "BT 种子",
  novel: "小说",
  game: "游戏",
};

const TYPE_ORDER = ["bangumi", "manga", "bt", "novel", "game"];

let miruPanelRender = null;

export async function reloadMiruPanel() {
  if (miruPanelRender) {
    await miruPanelRender({ preserveScroll: true, silent: true });
  }
}

export async function initializeMiruPanel() {
  const listEl = document.querySelector("#miruExtensionList");
  const statusEl = document.querySelector("#miruStatus");
  const refreshButton = document.querySelector("#miruRefreshButton");
  const healthButton = document.querySelector("#miruHealthButton");
  if (!listEl || !statusEl) return;

  let rendering = false;
  let repositoryRequested = false;
  async function render(options = {}) {
    if (rendering) return;
    rendering = true;
    try {
      const { preserveScroll = false, silent = false } = options;
      const scrollEl = preserveScroll ? findScrollContainer(listEl) : null;
      const scrollTop = scrollEl?.scrollTop ?? 0;

      if (!silent) {
        statusEl.textContent = "正在加载 Miru 仓库...";
      }
      listEl.innerHTML = `<div class="sources-page-stack" id="sourcesPageStack"></div>`;

      const stackEl = listEl.querySelector("#sourcesPageStack");

      renderBuiltinSources(stackEl);
      applyHealthResults(listEl);
      runHealthChecks(listEl);

      let repoPayload = null;
      let repoError = "";

      try {
        if (!document.querySelector("#miruView")?.hidden) {
          repositoryRequested = true;
          repoPayload = await fetchMiruRepo();
        }
      } catch (error) {
        repoError = error?.message || "连接失败";
        console.warn(error);
      }

      const installedPayload = await fetchMiruInstalled().catch(() => ({ list: [] }));
      const installedPackages = new Set(
        (installedPayload.list || []).map((item) => item.package)
      );

      await refreshWatchSources();

      const repoItems = repoPayload?.list?.length
        ? repoPayload.list.filter(
            (item) => /zh/i.test(item.lang || "") || installedPackages.has(item.package)
          )
        : installedPayload.list || [];

      if (repoItems.length) {
        statusEl.textContent = repoError
          ? `仓库连接异常，但已显示 ${repoItems.length} 个扩展。`
          : isTokusatsuMode()
            ? `特摄分区 · Tokuzilla 已启用`
            : `内置 ${onlineSources.filter((s) => s.partition !== "tokusatsu").length} 个在线片源 · Miru 仓库 ${repoItems.length} 个扩展`;
        if (!isTokusatsuMode()) {
          renderGroupedExtensions(repoItems, stackEl, installedPackages);
        }
      } else if (installedPayload.list?.length) {
        statusEl.textContent = repoError
          ? `Miru 仓库暂时不可用（${repoError}）。已安装 ${installedPayload.list.length} 个扩展。`
          : `已安装 ${installedPayload.list.length} 个 Miru 扩展。`;
        if (!isTokusatsuMode()) {
          renderGroupedExtensions(installedPayload.list, stackEl, installedPackages, true);
        }
      } else {
        statusEl.textContent = repoError
          ? `Miru 仓库连接失败：${repoError}。内置片源仍可使用。`
          : isTokusatsuMode()
            ? "特摄分区使用 Tokuzilla 片源。"
            : "Miru 仓库为空或暂时不可用，内置片源仍可用。";
        if (!isTokusatsuMode()) {
          stackEl.insertAdjacentHTML(
            "beforeend",
            `
          <section class="miru-type-section sources-panel sources-empty-panel">
            <p class="inline-empty">暂无 Miru 扩展，可稍后点刷新重试。</p>
          </section>
        `
          );
        }
      }

      applyHealthResults(listEl);
      runHealthChecks(listEl);

      if (scrollEl) {
        requestAnimationFrame(() => {
          scrollEl.scrollTop = scrollTop;
        });
      }
    } finally {
      rendering = false;
      if (!repositoryRequested && !document.querySelector("#miruView")?.hidden) {
        render({ silent: true }).catch(console.warn);
      }
    }
  }

  listEl.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-package]");
    if (!button || button.disabled) return;

    event.preventDefault();
    const packageName = button.dataset.package;
    const action = button.dataset.action;
    const card = button.closest(".source-card");

    setActionButtonBusy(button, action === "install" ? "安装中" : "移除中");

    try {
      if (action === "install") {
        await installMiruExtension(packageName);
      } else {
        await uninstallMiruExtension(packageName);
      }
      await refreshWatchSources();
      updateCardAfterAction(card, packageName, action === "install");
      if (action === "install" && card?.dataset.healthTarget) {
        await runHealthChecks(listEl);
      }
    } catch (error) {
      console.warn(error);
      statusEl.textContent = error.message || "操作失败";
      resetActionButton(button, action === "install" ? "安装" : "移除");
    }
  });

  refreshButton?.addEventListener("click", () => {
    render({ preserveScroll: true, silent: true });
  });

  healthButton?.addEventListener("click", () => {
    runHealthChecks(listEl, true);
  });

  document.addEventListener("anime:source-playback", event => {
    playbackResults.set(event.detail.source, { ...event.detail, checkedAt: Date.now() });
    applyHealthResults(listEl);
  });
  const autoToggle = document.querySelector("#sourceHealthAuto");
  try { autoToggle.checked = localStorage.getItem("anime-auto-health") !== "off"; } catch {}
  autoToggle?.addEventListener("change", () => {
    try { localStorage.setItem("anime-auto-health", autoToggle.checked ? "on" : "off"); } catch {}
    if (autoToggle.checked) runHealthChecks(listEl);
  });
  const checkWhenActive = () => {
    if (!document.hidden && navigator.onLine && autoToggle?.checked) runHealthChecks(listEl);
  };
  setInterval(checkWhenActive, 600000);
  document.addEventListener("visibilitychange", checkWhenActive);
  window.addEventListener("online", checkWhenActive);
  const view = document.querySelector("#miruView");
  if (view) new MutationObserver(() => {
    if (!view.hidden && !repositoryRequested) render({ silent: true });
  }).observe(view, { attributes: true, attributeFilter: ["hidden"] });
  miruPanelRender = render;
  await render();
}

function renderBuiltinSources(container) {
  if (!container) return;

  const sources = onlineSources.filter((source) =>
    isTokusatsuMode() ? source.partition === "tokusatsu" : source.partition !== "tokusatsu"
  );

  const section = document.createElement("section");
  section.className = "miru-type-section sources-panel sources-panel-builtin";
  section.innerHTML = `
    <div class="miru-type-head">
      <h4>${isTokusatsuMode() ? "特摄片源" : "内置在线片源"}</h4>
      <span class="miru-type-meta">${sources.length} 个 · 自动检查</span>
    </div>
    <p class="sources-panel-tip">${
      isTokusatsuMode()
        ? "特摄分区仅使用 Tokuzilla，与动漫片源完全分开。"
        : "播放番剧时优先尝试这些站点，无需安装。"
    }</p>
    <div class="sources-card-grid"></div>
  `;
  const grid = section.querySelector(".sources-card-grid");
  sources.forEach((source) => {
    grid.append(
      createSourceCard({
        name: source.name,
        package: source.id,
        type: "builtin",
        installed: true,
        healthTarget: source.id,
        hint: isTokusatsuMode() ? "特摄片源" : "内置片源",
      })
    );
  });
  container.append(section);
}

function renderGroupedExtensions(items, container, installedPackages, allInstalled = false) {
  if (!container) return;

  const groups = new Map();
  items.forEach((item) => {
    const type = item.type || "other";
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push({
      ...item,
      installed: allInstalled || installedPackages.has(item.package) || item.installed,
    });
  });

  const fragment = document.createDocumentFragment();

  TYPE_ORDER.concat("other").forEach((type) => {
    const groupItems = groups.get(type);
    if (!groupItems?.length) return;
    groups.delete(type);
    fragment.append(createExtensionSection(type, groupItems));
  });

  groups.forEach((groupItems, type) => {
    fragment.append(createExtensionSection(type, groupItems));
  });

  container.append(fragment);
}

function createExtensionSection(type, groupItems) {
  const unsupported = type !== "bangumi";
  const section = document.createElement("section");
  section.className = "miru-type-section sources-panel";
  section.innerHTML = `
    <div class="miru-type-head">
      <h4>${escape(TYPE_LABELS[type] || type)}</h4>
      <span class="miru-type-meta">${groupItems.length} 个${
        unsupported ? " · 暂不支持播放" : ""
      }</span>
    </div>
    <div class="sources-card-grid"></div>
  `;
  const grid = section.querySelector(".sources-card-grid");
  groupItems.forEach((item) => {
    grid.append(
      createSourceCard({
        ...item,
        healthTarget: item.installed && type === "bangumi" ? `miru:${item.package}` : "",
        disableInstall: unsupported,
        hint: unsupported ? "仅展示" : item.installed ? "已安装" : "可安装",
      })
    );
  });
  return section;
}

function createSourceCard(item) {
  const card = document.createElement("article");
  card.className = "source-card";
  card.dataset.healthTarget = item.healthTarget || "";

  const canInstall = item.type === "bangumi" || item.type === "builtin";
  const action = item.installed ? "uninstall" : "install";
  const actionLabel = item.type === "builtin"
    ? "内置"
    : item.installed
      ? "移除"
      : item.disableInstall
        ? "不支持"
        : "安装";

  const mark = document.createElement("div");
  mark.className = `source-card-mark source-card-mark--${resolveSourceIconKey(item)}`;
  mark.setAttribute("aria-hidden", "true");
  mark.innerHTML = sourceIconSvg(resolveSourceIconKey(item));

  const body = document.createElement("div");
  body.className = "source-card-body";

  const title = document.createElement("strong");
  title.className = "source-card-title";
  title.textContent = item.name || "";

  const id = document.createElement("span");
  id.className = "source-card-id";
  id.textContent = item.package || "";

  const hint = document.createElement("span");
  hint.className = "source-card-hint";
  hint.textContent = item.hint || "";

  body.append(title, id, hint);

  const foot = document.createElement("div");
  foot.className = "source-card-foot";

  const badge = document.createElement("span");
  badge.className = "health-badge";
  badge.dataset.healthState = "pending";
  badge.textContent = item.healthTarget ? "待检测" : "未安装";
  foot.append(badge);

  if (item.type === "builtin") {
    const enabled = document.createElement("span");
    enabled.className = "small-badge";
    enabled.textContent = "默认启用";
    foot.append(enabled);
  } else {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "small-button";
    button.dataset.package = item.package || "";
    button.dataset.action = action;
    if (!canInstall || item.disableInstall) button.disabled = true;
    button.textContent = actionLabel;
    foot.append(button);
  }

  card.append(mark, body, foot);
  return card;
}

const healthResults = new Map();
const playbackResults = new Map();
const healthPending = new Map();

function applyHealthResults(listEl) {
  let count = 0, ok = 0, bad = 0, checkedAt = 0;
  listEl.querySelectorAll(".source-card[data-health-target]").forEach(row => {
    const id = row.dataset.healthTarget;
    if (!id) return;
    count++;
    const badge = row.querySelector(".health-badge");
    const result = healthResults.get(id);
    if (!badge) return;
    if (healthPending.has(id)) {
      badge.className = "health-badge is-checking";
      badge.textContent = "检测中…";
      return;
    }
    if (!result) { badge.className = "health-badge"; badge.textContent = "待检测"; return; }
    const state = result.status || (result.ok ? "ok" : "suspect");
    if (state === "ok") ok++;
    if (state === "unavailable" || state === "suspect") bad++;
    checkedAt = Math.max(checkedAt, result.checkedAt || 0);
    badge.dataset.healthState = state;
    badge.className = 'health-badge ' + (state === 'ok' ? 'is-ok' : state === 'unavailable' ? 'is-fail' : 'is-warning');
    const labels = { ok: '搜索正常', suspect: '疑似异常', unavailable: '暂不可用', unknown: '待确认' };
    badge.textContent = (labels[state] || '待确认') + (state === 'ok' ? ' · ' + result.latency + 'ms' : '');
    badge.title = [result.error || '搜索接口正常，不代表所有剧集都可播放', result.checkedAt ? new Date(result.checkedAt).toLocaleString() : ''].filter(Boolean).join(' · ');
    row.dataset.health = state;
    let detail = row.querySelector('.source-health-detail');
    if (!detail) { detail = document.createElement('p'); detail.className = 'source-health-detail'; row.append(detail); }
    const playback = playbackResults.get(id);
    detail.textContent = playback
      ? (playback.ok ? '最近直链已加载：' : '最近直链失败：') + playback.label + (playback.error ? ' · ' + playback.error : '')
      : result.error || '已通过搜索接口检查';
  });
  const summary = document.querySelector('#sourceHealthSummary');
  if (summary) summary.textContent = healthPending.size
    ? '正在检测，已完成 ' + healthResults.size + ' 个片源…'
    : ok + '/' + count + ' 搜索正常 · ' + bad + ' 个异常' + (checkedAt ? ' · 最近检测 ' + new Date(checkedAt).toLocaleTimeString() : ' · 尚未检测');
}

async function runHealthChecks(listEl, force = false) {
  if (!force && document.querySelector('#sourceHealthAuto')?.checked === false) return;
  if (!navigator.onLine) {
    const summary = document.querySelector('#sourceHealthSummary');
    if (summary) summary.textContent = '当前网络离线，恢复联网后自动检测';
    return;
  }
  const ids = [...new Set([...listEl.querySelectorAll('[data-health-target]')].map(row => row.dataset.healthTarget).filter(Boolean))];
  const button = document.querySelector('#miruHealthButton');
  const jobs = ids.map(id => {
    if (healthPending.has(id)) return healthPending.get(id);
    if (!force && Date.now() - (healthResults.get(id)?.checkedAt || 0) < 600000) return Promise.resolve();
    const job = fetchSourceHealth(id, force).then(result => {
      healthResults.set(id, { ...result, checkedAt: result.checkedAt || Date.now() });
    }).catch(error => {
      // Local service failures are not evidence that the remote source is dead.
      healthResults.set(id, { source: id, status: 'unknown', checkedAt: Date.now(), error: '检测服务异常：' + error.message });
    }).finally(() => {
      healthPending.delete(id);
      applyHealthResults(listEl);
      if (button) button.disabled = healthPending.size > 0;
    });
    healthPending.set(id, job);
    return job;
  });
  if (button) button.disabled = healthPending.size > 0;
  applyHealthResults(listEl);
  await Promise.all(jobs);
}

function findScrollContainer(fromEl) {
  let node = fromEl;
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function setActionButtonBusy(button, label) {
  button.disabled = true;
  button.classList.add("is-busy");
  button.closest(".source-card")?.classList.add("is-action-busy");
  button.replaceChildren();
  const spinner = document.createElement("span");
  spinner.className = "btn-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = label;
  button.append(spinner, text);
}

function resetActionButton(button, label) {
  button.disabled = false;
  button.classList.remove("is-busy");
  button.closest(".source-card")?.classList.remove("is-action-busy");
  button.textContent = label;
}

function updateCardAfterAction(card, packageName, installed) {
  if (!card) return;

  const button = card.querySelector("button[data-package]");
  const hint = card.querySelector(".source-card-hint");
  if (!button) return;

  if (installed) {
    button.dataset.action = "uninstall";
    card.dataset.healthTarget = `miru:${packageName}`;
    if (hint) hint.textContent = "已安装";
    resetActionButton(button, "移除");
  } else {
    button.dataset.action = "install";
    card.dataset.healthTarget = "";
    if (hint) hint.textContent = "可安装";
    resetActionButton(button, "安装");

    const badge = card.querySelector(".health-badge");
    if (badge) {
      badge.dataset.healthState = "unknown";
      badge.className = "health-badge";
      badge.textContent = "未测";
      badge.title = "";
    }
  }
}

function resolveSourceIconKey(item) {
  const id = String(item.package || item.id || item.healthTarget || "").toLowerCase();
  const name = String(item.name || "").toLowerCase();
  if (item.type === "tokusatsu" || id.includes("tokuzilla") || name.includes("tokuzilla")) {
    return "tokusatsu";
  }
  if (id.includes("xfdm") || name.includes("稀饭")) return "xfdm";
  if (id.includes("gugu") || name.includes("咕咕")) return "gugu";
  if (id.includes("omo") || name.includes("omofun")) return "omofun";
  if (item.type === "builtin") return "builtin";
  if (item.type === "bt") return "bt";
  if (item.type === "manga") return "manga";
  if (item.type === "bangumi" || id.startsWith("miru:")) return "miru";
  return "default";
}

function sourceIconSvg(key) {
  const icons = {
    xfdm: `<svg viewBox="0 0 24 24" fill="none"><path d="M5 6.5h14v11H5v-11Z" stroke="currentColor" stroke-width="1.7"/><path d="m10 9.5 5 2.5-5 2.5v-5Z" fill="currentColor"/></svg>`,
    gugu: `<svg viewBox="0 0 24 24" fill="none"><path d="M6.5 16.5c2.2 1.6 4.3 2.3 5.5 2.3s3.3-.7 5.5-2.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="9" cy="10.5" r="1.2" fill="currentColor"/><circle cx="15" cy="10.5" r="1.2" fill="currentColor"/><path d="M7 8.2C8.2 6.4 10 5.4 12 5.4s3.8 1 5 2.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
    omofun: `<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 8.5 12 4.8l7.5 3.7v6.9L12 19.2 4.5 15.4V8.5Z" stroke="currentColor" stroke-width="1.7"/><path d="M12 8.2v7.5M8.8 10.2 15.2 13.6M15.2 10.2 8.8 13.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    tokusatsu: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3.8 19 7v5.4c0 4.1-2.8 7.5-7 8.8-4.2-1.3-7-4.7-7-8.8V7l7-3.2Z" stroke="currentColor" stroke-width="1.7"/><path d="M9.2 12.2 11 14l3.8-4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    miru: `<svg viewBox="0 0 24 24" fill="none"><path d="M8 4.8h3.2L12 7l.8-2.2H16v3.2L18.2 9 16 10.8v3.2h-3.2L12 16.2 11.2 14H8v-3.2L5.8 9 8 7.2V4.8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    manga: `<svg viewBox="0 0 24 24" fill="none"><path d="M6 5.5h5.2c1.4 0 2.3.8 2.8 1.5.5-.7 1.4-1.5 2.8-1.5H22v13h-5.2c-1.4 0-2.3.5-2.8 1.1-.5-.6-1.4-1.1-2.8-1.1H6v-13Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    bt: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 4.5v9.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m8.8 10.2 3.2 3.5 3.2-3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.2 16.8h11.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
    builtin: `<svg viewBox="0 0 24 24" fill="none"><path d="M4.8 10.8 12 5.5l7.2 5.3V18a1.2 1.2 0 0 1-1.2 1.2H6a1.2 1.2 0 0 1-1.2-1.2v-7.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
    default: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7.2" stroke="currentColor" stroke-width="1.7"/><path d="M10.2 12a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 0 0-3.6 0Z" fill="currentColor"/></svg>`,
  };
  return icons[key] || icons.default;
}

function escape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escape(value).replace(/`/g, "&#096;");
}
