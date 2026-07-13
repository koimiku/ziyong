import { isAndroidStandalone } from "./native/install.js";
import { APP_VERSION, GITHUB_REPO, GITHUB_RELEASES_URL } from "./version.js";

const SKIP_KEY = "anime-update-skip";
const CHECKED_KEY = "anime-update-checked-at";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let latestRelease = null;
let lastCheckError = "";

export function initializeAppUpdate() {
  const backdrop = document.querySelector("#appUpdateBackdrop");
  const dialog = document.querySelector("#appUpdateDialog");
  const updateButton = document.querySelector("#appUpdateConfirm");
  const dismissButton = document.querySelector("#appUpdateDismiss");
  const checkButton = document.querySelector("#settingsCheckUpdate");
  const openReleases = document.querySelector("#settingsOpenReleases");
  if (!backdrop || !dialog) return;

  updateButton?.addEventListener("click", () => {
    openDownload(latestRelease);
    closeUpdateDialog();
  });

  dismissButton?.addEventListener("click", () => {
    if (latestRelease?.version) {
      try {
        localStorage.setItem(SKIP_KEY, latestRelease.version);
      } catch {
        // ignore
      }
    }
    closeUpdateDialog();
  });

  backdrop.addEventListener("click", () => closeUpdateDialog());
  openReleases?.addEventListener("click", (event) => {
    event.preventDefault();
    openExternal(GITHUB_RELEASES_URL);
  });

  checkButton?.addEventListener("click", async () => {
    checkButton.disabled = true;
    checkButton.textContent = "检查中…";
    try {
      const release = await fetchLatestRelease();
      if (!release) {
        setUpdateStatus(
          `${friendlyCheckError(lastCheckError)} 当前 v${APP_VERSION}，可点「打开 Releases」手动查看。`
        );
        return;
      }
      if (!isNewerVersion(release.version, APP_VERSION)) {
        setUpdateStatus(`已是最新版 v${APP_VERSION}`);
        return;
      }
      setUpdateStatus("");
      showUpdateDialog(release);
    } finally {
      checkButton.disabled = false;
      checkButton.textContent = "检查更新";
    }
  });

  if (!isAndroidStandalone()) {
    hideAndroidUpdateCard();
    return;
  }

  void checkForAppUpdate();

  const App = window.Capacitor?.Plugins?.App;
  App?.addListener?.("appStateChange", ({ isActive }) => {
    if (isActive) void checkForAppUpdate();
  });
}

export async function checkForAppUpdate({ force = false } = {}) {
  if (!isAndroidStandalone()) return null;
  if (!force && !shouldCheckNow()) return null;

  const release = await fetchLatestRelease();
  markChecked();
  if (!release || !isNewerVersion(release.version, APP_VERSION)) return null;

  const skipped = safeGet(SKIP_KEY);
  if (skipped && skipped === release.version) return null;

  showUpdateDialog(release);
  return release;
}

function shouldCheckNow() {
  const last = Number(safeGet(CHECKED_KEY) || 0);
  if (!last) return true;
  return Date.now() - last > CHECK_INTERVAL_MS;
}

function markChecked() {
  try {
    localStorage.setItem(CHECKED_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

async function fetchLatestRelease() {
  lastCheckError = "";
  const errors = [];

  const attempts = [
    () => fetchUpdateManifest(),
    () => fetchGithubLatestRelease(),
    () => fetchGithubReleasesList(),
    () => fetchGithubLatestTag(),
    () => fetchPackageJsonRelease(),
  ];

  for (const attempt of attempts) {
    try {
      const release = await attempt();
      if (release?.version) {
        latestRelease = release;
        return release;
      }
    } catch (error) {
      const message = String(error?.message || error);
      errors.push(message);
      console.warn("Update check attempt failed:", message);
    }
  }

  lastCheckError = errors[0] || "网络不可用";
  return null;
}

async function fetchUpdateManifest() {
  const urls = [
    `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/update.json`,
    `https://raw.githubusercontent.com/${GITHUB_REPO}/main/update.json`,
    `https://fastly.jsdelivr.net/gh/${GITHUB_REPO}@main/update.json`,
  ];

  let data = null;
  let lastError = null;
  for (const url of urls) {
    try {
      data = await getJson(url);
      if (data?.version) break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!data?.version) {
    throw lastError || new Error("无法读取 update.json");
  }

  const version = normalizeVersion(data.version);
  return {
    version,
    name: data.name || `v${version}`,
    notes: String(data.notes || "").trim(),
    htmlUrl: data.htmlUrl || `${GITHUB_RELEASES_URL}/tag/v${version}`,
    apkUrl: data.apkUrl || `${GITHUB_RELEASES_URL}/tag/v${version}`,
  };
}

async function fetchGithubLatestRelease() {
  const data = await getJson(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
  );
  return parseGithubRelease(data);
}

async function fetchGithubReleasesList() {
  const list = await getJson(
    `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=5`
  );
  if (!Array.isArray(list) || !list.length) {
    throw new Error("Release 列表为空");
  }
  const release = list.find((item) => !item.draft && !item.prerelease) || list[0];
  return parseGithubRelease(release);
}

async function fetchGithubLatestTag() {
  const list = await getJson(
    `https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=5`
  );
  if (!Array.isArray(list) || !list.length) {
    throw new Error("Tag 列表为空");
  }
  const version = normalizeVersion(list[0]?.name || "");
  if (!version) throw new Error("Tag 无版本号");
  return {
    version,
    name: `v${version}`,
    notes: "检测到新标签版本。",
    htmlUrl: `${GITHUB_RELEASES_URL}/tag/v${version}`,
    apkUrl: `${GITHUB_RELEASES_URL}/tag/v${version}`,
  };
}

async function fetchPackageJsonRelease() {
  const urls = [
    `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/package.json`,
    `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`,
  ];

  let data = null;
  let lastError = null;
  for (const url of urls) {
    try {
      data = await getJson(url);
      if (data?.version) break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!data?.version) {
    throw lastError || new Error("无法读取 package.json 版本");
  }

  const version = normalizeVersion(data.version);
  return {
    version,
    name: `v${version}`,
    notes: "检测到仓库版本更新，请下载最新 APK 安装。",
    htmlUrl: `${GITHUB_RELEASES_URL}/tag/v${version}`,
    apkUrl: `${GITHUB_RELEASES_URL}/tag/v${version}`,
  };
}

function parseGithubRelease(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Release 数据无效");
  }
  if (data.message && /not found/i.test(data.message)) {
    throw new Error("HTTP 404");
  }
  const version = normalizeVersion(data.tag_name || data.name || "");
  if (!version) throw new Error("Release 无版本号");

  const apkAsset = (data.assets || []).find((asset) =>
    /\.apk$/i.test(asset.name || "")
  );

  return {
    version,
    name: data.name || `v${version}`,
    notes: String(data.body || "").trim(),
    htmlUrl: data.html_url || `${GITHUB_RELEASES_URL}/tag/v${version}`,
    apkUrl:
      apkAsset?.browser_download_url ||
      `${GITHUB_RELEASES_URL}/tag/v${version}`,
  };
}

function friendlyCheckError(raw) {
  const text = String(raw || "");
  if (/404|not found/i.test(text)) {
    return "无法访问 GitHub（仓库可能是 Private，或网络拦截）。";
  }
  if (/timeout|超时|network|failed to fetch/i.test(text)) {
    return "网络异常，暂时连不上更新源。";
  }
  return text ? `检查失败：${text}。` : "暂时无法检查更新。";
}

async function getJson(url) {
  if (isAndroidStandalone()) {
    try {
      return await getJsonNative(url);
    } catch (error) {
      console.warn("CapacitorHttp failed, fallback fetch:", error);
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "anime-android-update/1.3",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function getJsonNative(url) {
  const Http = window.Capacitor?.Plugins?.CapacitorHttp;
  if (!Http?.get) {
    throw new Error("CapacitorHttp unavailable");
  }

  const response = await Http.get({
    url,
    headers: {
      Accept: "application/json",
      "User-Agent": "anime-android-update/1.3",
    },
    connectTimeout: 15000,
    readTimeout: 20000,
    responseType: "json",
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = response.data;
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      throw new Error("返回内容不是 JSON");
    }
  }
  if (data?.message && /not found/i.test(data.message)) {
    throw new Error("HTTP 404");
  }
  return data;
}

function showUpdateDialog(release) {
  latestRelease = release;
  const dialog = document.querySelector("#appUpdateDialog");
  const backdrop = document.querySelector("#appUpdateBackdrop");
  const title = document.querySelector("#appUpdateTitle");
  const tip = document.querySelector("#appUpdateTip");
  const notes = document.querySelector("#appUpdateNotes");
  if (!dialog || !backdrop) return;

  if (title) title.textContent = `发现新版本 v${release.version}`;
  if (tip) {
    tip.textContent = `当前 v${APP_VERSION}，可前往 GitHub 下载安装包更新。`;
  }
  if (notes) {
    const preview = release.notes
      ? release.notes.split(/\r?\n/).filter(Boolean).slice(0, 6).join("\n")
      : "暂无更新说明。";
    notes.textContent = preview;
    notes.hidden = !preview;
  }

  backdrop.classList.add("is-open");
  dialog.classList.add("is-open");
  document.body.classList.add("app-update-open");
}

function closeUpdateDialog() {
  document.querySelector("#appUpdateBackdrop")?.classList.remove("is-open");
  document.querySelector("#appUpdateDialog")?.classList.remove("is-open");
  document.body.classList.remove("app-update-open");
}

function openDownload(release) {
  openExternal(release?.apkUrl || release?.htmlUrl || GITHUB_RELEASES_URL);
}

function openExternal(url) {
  const target = url || GITHUB_RELEASES_URL;
  const Browser = window.Capacitor?.Plugins?.Browser;
  if (Browser?.open) {
    Browser.open({ url: target }).catch(() => {
      window.open(target, "_blank", "noopener,noreferrer");
    });
    return;
  }
  try {
    window.open(target, "_blank", "noopener,noreferrer");
  } catch {
    window.location.href = target;
  }
}

function setUpdateStatus(message) {
  const status = document.querySelector("#settingsUpdateStatus");
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
}

function hideAndroidUpdateCard() {
  document.querySelector("#androidUpdateCard")?.setAttribute("hidden", "");
}

function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "")
    .split(/[+\s]/)[0];
}

export function isNewerVersion(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return false;
}

function parseVersion(value) {
  return normalizeVersion(value)
    .split(".")
    .map((part) => Number.parseInt(part.replace(/[^\d].*$/, ""), 10) || 0);
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
