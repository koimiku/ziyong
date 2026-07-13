import {
  fetchMiruInstalled,
  fetchMiruRepo,
  fetchSourceHealth,
  fetchSourcesHealth,
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

  async function render(options = {}) {
    const { preserveScroll = false, silent = false } = options;
    const scrollEl = preserveScroll ? findScrollContainer(listEl) : null;
    const scrollTop = scrollEl?.scrollTop ?? 0;

    if (!silent) {
      statusEl.textContent = "正在加载 Miru 仓库...";
    }
    listEl.innerHTML = `<div class="sources-page-stack" id="sourcesPageStack"></div>`;

    const stackEl = listEl.querySelector("#sourcesPageStack");

    await refreshWatchSources();

    let repoPayload = null;
    let repoError = "";

    try {
      repoPayload = await fetchMiruRepo();
    } catch (error) {
      repoError = error?.message || "连接失败";
      console.warn(error);
    }

    const installedPayload = await fetchMiruInstalled().catch(() => ({ list: [] }));
    const installedPackages = new Set(
      (installedPayload.list || []).map((item) => item.package)
    );

    renderBuiltinSources(stackEl);

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

    runHealthChecks(listEl);

    if (scrollEl) {
      requestAnimationFrame(() => {
        scrollEl.scrollTop = scrollTop;
      });
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
      <span class="miru-type-meta">${sources.length} 个 · 默认可用</span>
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
  mark.className = "source-card-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = String(item.name || "?").slice(0, 1);

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
  badge.textContent = "检测中";
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

async function runHealthChecks(listEl, force = false) {
  const rows = [...listEl.querySelectorAll(".source-card[data-health-target]")].filter(
    (row) => row.dataset.healthTarget
  );
  if (!rows.length) return;

  const statusEl = document.querySelector("#miruStatus");
  if (statusEl && force) {
    statusEl.textContent = "正在检测片源可用性...";
  }

  rows.forEach((row) => {
    const badge = row.querySelector(".health-badge");
    if (!badge) return;
    if (!force && badge.dataset.healthState === "ok") return;
    badge.dataset.healthState = "checking";
    badge.textContent = "检测中";
    badge.className = "health-badge is-checking";
  });

  try {
    let payload = await fetchSourcesHealth().catch(() => ({ list: [] }));
    let list = Array.isArray(payload.list) ? payload.list : [];

    // Fallback: probe each visible source individually when batch is empty.
    if (!list.length) {
      list = await Promise.all(
        rows.map(async (row) => {
          const sourceId = row.dataset.healthTarget;
          try {
            return await fetchSourceHealth(sourceId);
          } catch (error) {
            return {
              source: sourceId,
              ok: false,
              latency: 0,
              error: error?.message || "检测失败",
            };
          }
        })
      );
    }

    const healthMap = new Map(list.map((entry) => [entry.source, entry]));
    let okCount = 0;

    rows.forEach((row) => {
      const badge = row.querySelector(".health-badge");
      if (!badge) return;
      const result = healthMap.get(row.dataset.healthTarget);
      if (!result) {
        badge.dataset.healthState = "unknown";
        badge.className = "health-badge";
        badge.textContent = "未测";
        return;
      }
      if (result.ok) okCount += 1;
      badge.dataset.healthState = result.ok ? "ok" : "fail";
      badge.className = `health-badge ${result.ok ? "is-ok" : "is-fail"}`;
      badge.textContent = result.ok
        ? `可用 · ${result.latency}ms`
        : result.error?.slice(0, 18) || "不可用";
      badge.title = result.error || "";
    });

    if (statusEl && force) {
      statusEl.textContent = `可用性检测完成：${okCount}/${rows.length} 可用`;
    }
  } catch (error) {
    rows.forEach((row) => {
      const badge = row.querySelector(".health-badge");
      if (!badge) return;
      badge.dataset.healthState = "fail";
      badge.className = "health-badge is-fail";
      badge.textContent = "检测失败";
      badge.title = error.message || "";
    });
    if (statusEl && force) {
      statusEl.textContent = error.message || "可用性检测失败";
    }
  }
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
