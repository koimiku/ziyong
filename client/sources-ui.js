import {
  fetchKazumiInstalled,
  fetchKazumiRepo,
  fetchSourceHealth,
  importKazumiRule,
  installKazumiRule,
  refreshWatchSources,
  uninstallKazumiRule,
} from "./sources.js";
import { onlineSources } from "./config.js";
import { isTokusatsuMode } from "./content-mode.js";

export async function initializeSourcesPanel() {
  const listEl = document.querySelector("#miruExtensionList");
  const statusEl = document.querySelector("#miruStatus");
  const refreshButton = document.querySelector("#miruRefreshButton");
  const healthButton = document.querySelector("#miruHealthButton");
  const view = document.querySelector("#miruView");
  if (!listEl || !statusEl) return;

  let rendering = false;
  let installingAll = false;
  let seeding = false;
  let catalogRequested = false;

  async function render(options = {}) {
    if (rendering) return;
    rendering = true;
    try {
      const { preserveScroll = false, silent = false, statusText = "" } = options;
      const scrollEl = preserveScroll ? findScrollContainer(listEl) : null;
      const scrollTop = scrollEl?.scrollTop ?? 0;
      const includeCatalog = !view?.hidden;
      if (includeCatalog) catalogRequested = true;

      if (!silent) statusEl.textContent = "正在加载片源…";

      const stackEl = document.createElement("div");
      stackEl.className = "sources-page-stack";
      stackEl.id = "sourcesPageStack";
      renderBuiltinSources(stackEl);

      let installedCount = 0;
      let repoError = "";
      if (!isTokusatsuMode()) {
        ({ installedCount, repoError } = await renderKazumiSection(stackEl, { includeCatalog }));
      }
      listEl.replaceChildren(stackEl);

      document.querySelector("#kazumiImportForm")?.toggleAttribute("hidden", isTokusatsuMode());
      document.querySelector("#installAllSourcesButton")?.toggleAttribute("hidden", isTokusatsuMode());

      await refreshWatchSources();

      const builtinCount = onlineSources.filter((s) => s.partition !== "tokusatsu").length;
      statusEl.textContent =
        statusText ||
        (isTokusatsuMode()
          ? "特摄分区使用 Tokuzilla 片源。"
          : seeding
            ? "正在安装默认规则…"
            : repoError
              ? `规则仓库暂时连不上（${repoError}）。内置片源和已安装的 ${installedCount} 条规则仍可使用。`
              : `内置 ${builtinCount} 个在线片源 · 已安装 ${installedCount} 条规则`);

      applyHealthResults(listEl);
      runHealthChecks(listEl);

      if (scrollEl) {
        requestAnimationFrame(() => {
          scrollEl.scrollTop = scrollTop;
        });
      }
    } finally {
      rendering = false;
    }
  }

  listEl.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-kazumi-name]");
    if (!button || button.disabled) return;
    event.preventDefault();
    const name = button.dataset.kazumiName;
    const action = button.dataset.kazumiAction;
    setActionButtonBusy(button, action === "install" ? "安装中" : "移除中");
    try {
      if (action === "install") await installKazumiRule(name);
      else await uninstallKazumiRule(name);
      await render({ preserveScroll: true, silent: true });
    } catch (error) {
      console.warn(error);
      statusEl.textContent = error.message || "规则操作失败";
      resetActionButton(button, action === "install" ? "安装" : "移除");
    }
  });

  document.querySelector("#kazumiImportForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector("#kazumiImportInput");
    const importStatus = document.querySelector("#kazumiImportStatus");
    const raw = input?.value.trim() || "";
    if (!raw) return;
    if (importStatus) importStatus.textContent = "正在导入规则...";
    try {
      if (raw.startsWith("{")) await importKazumiRule({ json: raw });
      else if (/^https?:\/\//i.test(raw)) await importKazumiRule({ url: raw });
      else await installKazumiRule(raw);
      if (input) input.value = "";
      if (importStatus) importStatus.textContent = "规则已导入，播放时会自动参与匹配。";
      await render({ preserveScroll: true, silent: true });
    } catch (error) {
      console.warn(error);
      if (importStatus) importStatus.textContent = error.message || "导入失败";
    }
  });

  const installAllButton = document.querySelector("#installAllSourcesButton");

  refreshButton?.addEventListener("click", () => {
    if (installingAll) return;
    statusEl.textContent = "正在刷新片源…";
    void render({ preserveScroll: true });
  });

  healthButton?.addEventListener("click", () => {
    runHealthChecks(listEl, true);
  });

  installAllButton?.addEventListener("click", () => {
    void installAllRules();
  });

  async function installAllRules() {
    if (installingAll || !installAllButton || installAllButton.disabled) return;
    installingAll = true;
    const idleLabel = "一键安装全部";
    installAllButton.disabled = true;
    installAllButton.classList.add("is-busy");
    installAllButton.textContent = "正在准备…";
    try {
      if (isTokusatsuMode()) {
        statusEl.textContent = "特摄分区使用内置片源，无需安装规则。";
        return;
      }

      statusEl.textContent = "正在读取规则仓库…";
      const repo = await fetchKazumiRepo();
      const jobs = (repo.list || []).filter(
        (item) => item?.name && !item.installed && (!item.type || item.type === "anime")
      );

      if (!jobs.length) {
        statusEl.textContent = "可安装的规则都已经装好了。";
        return;
      }

      let finished = 0;
      let ok = 0;
      const failed = [];
      let cursor = 0;
      const workers = Array.from({ length: Math.min(3, jobs.length) }, async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor];
          cursor += 1;
          statusEl.textContent = `正在安装 ${finished + 1}/${jobs.length}：${job.name}`;
          installAllButton.textContent = `安装中 ${finished}/${jobs.length}`;
          try {
            await installKazumiRule(job.name);
            ok += 1;
            markRuleInstalled(listEl, job.name);
          } catch (error) {
            failed.push(job.name);
            console.warn(error);
          } finally {
            finished += 1;
            installAllButton.textContent = `安装中 ${finished}/${jobs.length}`;
          }
        }
      });
      await Promise.all(workers);

      const failPreview = failed.slice(0, 3).join("、");
      const summary = failed.length
        ? `已安装 ${ok} 条规则，${failed.length} 条失败${failPreview ? `：${failPreview}` : ""}${failed.length > 3 ? "…" : ""}。`
        : `已安装全部 ${ok} 条规则。`;
      while (rendering) await new Promise((resolve) => setTimeout(resolve, 40));
      await render({ preserveScroll: true, silent: true, statusText: summary });
    } catch (error) {
      console.warn(error);
      statusEl.textContent = error?.message || "一键安装失败";
    } finally {
      installingAll = false;
      installAllButton.disabled = false;
      installAllButton.classList.remove("is-busy");
      installAllButton.textContent = idleLabel;
    }
  }

  document.addEventListener("anime:sources-seeding", (event) => {
    seeding = !event.detail?.done;
    if (seeding) {
      if (!isTokusatsuMode()) statusEl.textContent = "正在安装默认规则…";
      return;
    }
    const installed = Number(event.detail?.result?.installed || 0);
    if (installed > 0) {
      void render({
        preserveScroll: true,
        silent: true,
        statusText: `已自动安装 ${installed} 条规则。`,
      });
    } else {
      void render({ preserveScroll: true, silent: true });
    }
  });

  document.addEventListener("anime:source-playback", (event) => {
    playbackResults.set(event.detail.source, { ...event.detail, checkedAt: Date.now() });
    applyHealthResults(listEl);
  });
  const autoToggle = document.querySelector("#sourceHealthAuto");
  try {
    if (autoToggle) autoToggle.checked = localStorage.getItem("anime-auto-health") !== "off";
  } catch {
    // Default to automatic checks when storage is unavailable.
  }
  autoToggle?.addEventListener("change", () => {
    try {
      localStorage.setItem("anime-auto-health", autoToggle.checked ? "on" : "off");
    } catch {
      // The toggle still applies for this session.
    }
    if (autoToggle.checked) runHealthChecks(listEl);
  });
  const checkWhenActive = () => {
    if (!document.hidden && navigator.onLine && autoToggle?.checked) runHealthChecks(listEl);
  };
  setInterval(checkWhenActive, 600000);
  document.addEventListener("visibilitychange", checkWhenActive);
  document.addEventListener("anime:watch-ended", checkWhenActive);
  window.addEventListener("online", checkWhenActive);
  if (view) {
    new MutationObserver(() => {
      if (!view.hidden && !catalogRequested) void render({ silent: true });
    }).observe(view, { attributes: true, attributeFilter: ["hidden"] });
  }
  await render();
}

function renderBuiltinSources(container) {
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

async function renderKazumiSection(container, { includeCatalog = true } = {}) {
  const section = document.createElement("section");
  section.className = "miru-type-section sources-panel";

  let repoError = "";
  const [repo, local] = await Promise.all([
    includeCatalog
      ? fetchKazumiRepo().catch((error) => {
          repoError = error.message || "连接失败";
          return { list: [] };
        })
      : Promise.resolve({ list: [] }),
    fetchKazumiInstalled().catch(() => ({ list: [] })),
  ]);
  const repoItems = repo.list || [];
  const installed = local.list || [];

  const installedNames = new Set(installed.map((item) => item.name));
  const catalog = new Map();
  for (const item of repoItems) catalog.set(item.name, item);
  for (const item of installed) {
    if (!catalog.has(item.name)) catalog.set(item.name, { ...item, installed: true });
  }
  const items = [...catalog.values()].sort((a, b) => {
    const aInstalled = installedNames.has(a.name) || a.installed ? 0 : 1;
    const bInstalled = installedNames.has(b.name) || b.installed ? 0 : 1;
    return aInstalled - bInstalled || String(a.name).localeCompare(String(b.name));
  });

  section.innerHTML = `
    <div class="miru-type-head">
      <h4>片源规则</h4>
      <span class="miru-type-meta">已安装 ${installedNames.size} · 共 ${items.length} 条${repoError ? " · 仓库暂不可用" : ""}</span>
    </div>
    <div class="sources-card-grid"></div>
  `;
  const grid = section.querySelector(".sources-card-grid");
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "inline-empty";
    empty.textContent = repoError
      ? `规则仓库暂时不可用（${repoError}）。可以在上方输入规则名或 JSON 导入。`
      : "暂无规则。在上方输入规则名、规则链接，或粘贴 JSON。";
    section.append(empty);
  }
  items.forEach((item) => {
    const isInstalled = installedNames.has(item.name) || item.installed;
    grid.append(
      createSourceCard({
        name: item.name,
        package: item.name,
        type: "kazumi",
        installed: isInstalled,
        healthTarget: isInstalled ? `kazumi:${item.name}` : "",
        hint: item.version ? `v${item.version}` : "规则",
      })
    );
  });
  container.append(section);
  return { installedCount: installedNames.size, repoError };
}

function createSourceCard(item) {
  const card = document.createElement("article");
  card.className = "source-card";
  card.dataset.healthTarget = item.healthTarget || "";

  const action = item.installed ? "uninstall" : "install";
  const actionLabel = item.type === "builtin" ? "内置" : item.installed ? "移除" : "安装";
  const iconKey = resolveSourceIconKey(item);

  const mark = document.createElement("div");
  mark.className = `source-card-mark source-card-mark--${iconKey}`;
  mark.setAttribute("aria-hidden", "true");
  mark.innerHTML = sourceIconSvg(iconKey);

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
    button.className = "small-button source-action-button";
    button.dataset.kazumiName = item.package || "";
    button.dataset.kazumiAction = action;
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
  let count = 0;
  let ok = 0;
  let bad = 0;
  let checkedAt = 0;
  listEl.querySelectorAll(".source-card[data-health-target]").forEach((row) => {
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
    if (!result) {
      badge.className = "health-badge";
      badge.textContent = "待检测";
      return;
    }
    const state = result.status || (result.ok ? "ok" : "suspect");
    if (state === "ok") ok++;
    if (state === "unavailable" || state === "suspect") bad++;
    checkedAt = Math.max(checkedAt, result.checkedAt || 0);
    badge.dataset.healthState = state;
    badge.className =
      "health-badge " + (state === "ok" ? "is-ok" : state === "unavailable" ? "is-fail" : "is-warning");
    const labels = { ok: "搜索正常", suspect: "疑似异常", unavailable: "暂不可用", unknown: "待确认" };
    badge.textContent = (labels[state] || "待确认") + (state === "ok" ? " · " + result.latency + "ms" : "");
    badge.title = [
      result.error || "搜索接口正常，不代表所有剧集都可播放",
      result.checkedAt ? new Date(result.checkedAt).toLocaleString() : "",
    ]
      .filter(Boolean)
      .join(" · ");
    row.dataset.health = state;
    let detail = row.querySelector(".source-health-detail");
    if (!detail) {
      detail = document.createElement("p");
      detail.className = "source-health-detail";
      row.append(detail);
    }
    const playback = playbackResults.get(id);
    detail.textContent = playback
      ? (playback.ok ? "最近直链已加载：" : "最近直链失败：") +
        playback.label +
        (playback.error ? " · " + playback.error : "")
      : result.error || "已通过搜索接口检查";
  });
  const summary = document.querySelector("#sourceHealthSummary");
  if (summary) {
    summary.textContent = healthPending.size
      ? "正在检测，已完成 " + healthResults.size + " 个片源…"
      : ok +
        "/" +
        count +
        " 搜索正常 · " +
        bad +
        " 个异常" +
        (checkedAt ? " · 最近检测 " + new Date(checkedAt).toLocaleTimeString() : " · 尚未检测");
  }
}

async function runHealthChecks(listEl, force = false) {
  if (!force && (document.hidden || document.querySelector(".app-shell")?.classList.contains("is-watching"))) return;
  if (!force && document.querySelector("#sourceHealthAuto")?.checked === false) return;
  if (!navigator.onLine) {
    const summary = document.querySelector("#sourceHealthSummary");
    if (summary) summary.textContent = "当前网络离线，恢复联网后自动检测";
    return;
  }
  const ids = [
    ...new Set(
      [...listEl.querySelectorAll("[data-health-target]")]
        .map((row) => row.dataset.healthTarget)
        .filter(Boolean)
    ),
  ];
  const button = document.querySelector("#miruHealthButton");
  const jobs = ids.map((id) => {
    if (healthPending.has(id)) return healthPending.get(id);
    if (!force && Date.now() - (healthResults.get(id)?.checkedAt || 0) < 600000) return Promise.resolve();
    const job = fetchSourceHealth(id, force)
      .then((result) => {
        healthResults.set(id, { ...result, checkedAt: result.checkedAt || Date.now() });
      })
      .catch((error) => {
        // Local service failures are not evidence that the remote source is dead.
        healthResults.set(id, {
          source: id,
          status: "unknown",
          checkedAt: Date.now(),
          error: "检测服务异常：" + error.message,
        });
      })
      .finally(() => {
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
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function markRuleInstalled(listEl, name) {
  const button = listEl.querySelector(`button[data-kazumi-name="${CSS.escape(name)}"]`);
  const card = button?.closest(".source-card");
  if (!button || !card) return;
  button.dataset.kazumiAction = "uninstall";
  card.dataset.healthTarget = `kazumi:${name}`;
  const hint = card.querySelector(".source-card-hint");
  if (hint && !/v\d/i.test(hint.textContent || "")) hint.textContent = "已安装";
  resetActionButton(button, "移除");
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

function resolveSourceIconKey(item) {
  const id = String(item.package || item.id || item.healthTarget || "").toLowerCase();
  const name = String(item.name || "").toLowerCase();
  if (item.type === "tokusatsu" || id.includes("tokuzilla") || name.includes("tokuzilla")) {
    return "tokusatsu";
  }
  if (item.type === "kazumi") return "kazumi";
  if (id.includes("xfdm") || name.includes("稀饭")) return "xfdm";
  if (id.includes("gugu") || name.includes("咕咕")) return "gugu";
  if (id.includes("omo") || name.includes("omofun")) return "omofun";
  if (item.type === "builtin") return "builtin";
  return "default";
}

function sourceIconSvg(key) {
  const icons = {
    xfdm: `<svg viewBox="0 0 24 24" fill="none"><path d="M5 6.5h14v11H5v-11Z" stroke="currentColor" stroke-width="1.7"/><path d="m10 9.5 5 2.5-5 2.5v-5Z" fill="currentColor"/></svg>`,
    gugu: `<svg viewBox="0 0 24 24" fill="none"><path d="M6.5 16.5c2.2 1.6 4.3 2.3 5.5 2.3s3.3-.7 5.5-2.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="9" cy="10.5" r="1.2" fill="currentColor"/><circle cx="15" cy="10.5" r="1.2" fill="currentColor"/><path d="M7 8.2C8.2 6.4 10 5.4 12 5.4s3.8 1 5 2.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
    omofun: `<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 8.5 12 4.8l7.5 3.7v6.9L12 19.2 4.5 15.4V8.5Z" stroke="currentColor" stroke-width="1.7"/><path d="M12 8.2v7.5M8.8 10.2 15.2 13.6M15.2 10.2 8.8 13.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    tokusatsu: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3.8 19 7v5.4c0 4.1-2.8 7.5-7 8.8-4.2-1.3-7-4.7-7-8.8V7l7-3.2Z" stroke="currentColor" stroke-width="1.7"/><path d="M9.2 12.2 11 14l3.8-4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    kazumi: `<svg viewBox="0 0 24 24" fill="none"><path d="M7 6.5h10v11H7v-11Z" stroke="currentColor" stroke-width="1.7"/><path d="M9.5 10.2h5M9.5 13.4h3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
    builtin: `<svg viewBox="0 0 24 24" fill="none"><path d="M4.8 10.8 12 5.5l7.2 5.3V18a1.2 1.2 0 0 1-1.2 1.2H6a1.2 1.2 0 0 1-1.2-1.2v-7.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
    default: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7.2" stroke="currentColor" stroke-width="1.7"/><path d="M10.2 12a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 0 0-3.6 0Z" fill="currentColor"/></svg>`,
  };
  return icons[key] || icons.default;
}
