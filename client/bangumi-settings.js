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

  if (status) {
    const parts = [`上次同步：${formatTime(meta.lastSyncAt)}`];
    if (meta.lastError) parts.push(`错误：${meta.lastError}`);
    status.textContent = parts.join(" · ");
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

async function withBusy(button, task) {
  if (!button) return task();
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "处理中…";
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.textContent = label;
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
    void withBusy(loginButton, async () => {
      const token = tokenInput?.value?.trim() || getBangumiToken();
      await loginBangumiWithToken(token);
      if (tokenInput) tokenInput.value = "";
    }).catch((error) => {
      const status = document.querySelector("#bangumiSyncStatus");
      if (status) status.textContent = String(error?.message || error);
    });
  });

  logoutButton?.addEventListener("click", () => {
    logoutBangumi();
    renderBangumiSettings();
  });

  syncButton?.addEventListener("click", () => {
    void withBusy(syncButton, async () => {
      await syncBangumiHistory({ reason: "manual" });
    }).catch((error) => {
      const status = document.querySelector("#bangumiSyncStatus");
      if (status) status.textContent = String(error?.message || error);
    });
  });

  document.addEventListener("anime:bangumi-auth-changed", renderBangumiSettings);
  document.addEventListener("anime:bangumi-sync-changed", renderBangumiSettings);
  renderBangumiSettings();

  void initializeBangumiSync().finally(renderBangumiSettings);
}
