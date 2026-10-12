import {
  getBangumiSyncMeta,
  getBangumiToken,
  getBangumiUser,
  initializeBangumiSync,
  isBangumiLoggedIn,
  loginBangumiWithToken,
  logoutBangumi,
  syncBangumiHistory,
} from "./bangumi-sync.js";

const TOKEN_PAGE = "https://next.bgm.tv/demo/access-token";

function formatTime(ts) {
  const value = Number(ts || 0);
  if (!value) return "尚未同步";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "尚未同步";
  }
}

function setSyncStatus(text, tone = "") {
  const status = document.querySelector("#bangumiSyncStatus");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-busy", tone === "busy");
  status.classList.toggle("is-ok", tone === "ok");
}

function renderBangumiSettings() {
  const status = document.querySelector("#bangumiSyncStatus");
  const userLine = document.querySelector("#bangumiUserLine");
  const tokenInput = document.querySelector("#bangumiTokenInput");
  const loginButton = document.querySelector("#bangumiLoginButton");
  const logoutButton = document.querySelector("#bangumiLogoutButton");
  const syncButton = document.querySelector("#bangumiSyncButton");
  const meta = getBangumiSyncMeta();
  const user = getBangumiUser();
  const loggedIn = isBangumiLoggedIn();

  if (userLine) {
    userLine.textContent = loggedIn
      ? `已登录：${user.nickname || user.username}（@${user.username}）`
      : "未登录：电脑和手机用同一 Bangumi 账号即可同步番剧进度。";
  }

  if (status && !status.classList.contains("is-busy")) {
    if (meta.lastError) setSyncStatus(meta.lastError, "error");
    else if (meta.lastSyncAt) setSyncStatus(`已同步 · ${formatTime(meta.lastSyncAt)}`, "ok");
    else setSyncStatus("尚未同步");
  }

  if (tokenInput) {
    tokenInput.hidden = loggedIn;
    if (!loggedIn && !tokenInput.value) {
      tokenInput.placeholder = "粘贴 Access Token";
    }
  }
  if (loginButton) loginButton.hidden = loggedIn;
  if (logoutButton) logoutButton.hidden = !loggedIn;
  if (syncButton) syncButton.hidden = !loggedIn;
}

function setButtonBusy(button, label) {
  button.disabled = true;
  button.classList.add("is-busy");
  button.setAttribute("aria-busy", "true");
  button.replaceChildren();
  const spinner = document.createElement("span");
  spinner.className = "btn-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = label;
  button.append(spinner, text);
}

function clearButtonBusy(button, label) {
  button.disabled = false;
  button.classList.remove("is-busy");
  button.removeAttribute("aria-busy");
  button.textContent = label;
}

async function withBusy(button, busyLabel, task) {
  if (!button || button.disabled) return task();
  const label = button.dataset.idleLabel || button.textContent.trim();
  button.dataset.idleLabel = label;
  setButtonBusy(button, busyLabel);
  try {
    return await task();
  } finally {
    clearButtonBusy(button, label);
    renderBangumiSettings();
  }
}

export function initializeBangumiSettings() {
  const loginButton = document.querySelector("#bangumiLoginButton");
  const logoutButton = document.querySelector("#bangumiLogoutButton");
  const syncButton = document.querySelector("#bangumiSyncButton");
  const tokenInput = document.querySelector("#bangumiTokenInput");
  const openToken = document.querySelector("#bangumiOpenTokenPage");

  openToken?.addEventListener("click", (event) => {
    event.preventDefault();
    window.open(TOKEN_PAGE, "_blank", "noopener,noreferrer");
  });

  loginButton?.addEventListener("click", () => {
    if (loginButton.disabled) return;
    setSyncStatus("正在登录并同步…", "busy");
    void withBusy(loginButton, "登录中", async () => {
      const token = tokenInput?.value?.trim() || getBangumiToken();
      await loginBangumiWithToken(token);
      if (tokenInput) tokenInput.value = "";
      setSyncStatus(`已同步 · ${formatTime(getBangumiSyncMeta().lastSyncAt)}`, "ok");
    }).catch((error) => {
      setSyncStatus(String(error?.message || error), "error");
    });
  });

  logoutButton?.addEventListener("click", () => {
    logoutBangumi();
    renderBangumiSettings();
  });

  syncButton?.addEventListener("click", () => {
    if (syncButton.disabled) return;
    setSyncStatus("正在同步观看进度…", "busy");
    void withBusy(syncButton, "同步中", async () => {
      await syncBangumiHistory({ reason: "manual" });
      const meta = getBangumiSyncMeta();
      if (meta.lastError) setSyncStatus(meta.lastError, "error");
      else setSyncStatus(`已同步 · ${formatTime(meta.lastSyncAt)}`, "ok");
    }).catch((error) => {
      setSyncStatus(String(error?.message || error), "error");
    });
  });

  document.addEventListener("anime:bangumi-auth-changed", renderBangumiSettings);
  document.addEventListener("anime:bangumi-sync-changed", renderBangumiSettings);
  renderBangumiSettings();

  void initializeBangumiSync().finally(renderBangumiSettings);
}
