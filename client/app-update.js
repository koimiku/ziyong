import { isAndroidStandalone } from "./native/install.js";
import { APP_VERSION, GITHUB_REPO, GITHUB_RELEASES_URL } from "./version.js";

const SKIP_KEY = "anime-update-skip";
const CHECKED_KEY = "anime-update-checked-at";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let latestRelease = null;

export function initializeAppUpdate() {
  const backdrop = document.querySelector("#appUpdateBackdrop");
  const dialog = document.querySelector("#appUpdateDialog");
  const updateButton = document.querySelector("#appUpdateConfirm");
  const dismissButton = document.querySelector("#appUpdateDismiss");
  const checkButton = document.querySelector("#settingsCheckUpdate");
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

  checkButton?.addEventListener("click", async () => {
    checkButton.disabled = true;
    checkButton.textContent = "检查中…";
    try {
      const release = await fetchLatestRelease({ force: true });
      if (!release) {
        setUpdateStatus("暂时无法检查更新，请稍后再试。");
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

  try {
    import("@capacitor/app").then(({ App }) => {
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void checkForAppUpdate();
      });
    });
  } catch {
    // ignore
  }
}

export async function checkForAppUpdate({ force = false } = {}) {
  if (!isAndroidStandalone()) return null;
  if (!force && !shouldCheckNow()) return null;

  const release = await fetchLatestRelease({ force });
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

async function fetchLatestRelease({ force = false } = {}) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github+json" },
        cache: force ? "no-store" : "default",
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const version = normalizeVersion(data.tag_name || data.name || "");
    if (!version) return null;

    const apkAsset = (data.assets || []).find((asset) =>
      /\.apk$/i.test(asset.name || "")
    );

    latestRelease = {
      version,
      name: data.name || `v${version}`,
      notes: String(data.body || "").trim(),
      htmlUrl: data.html_url || GITHUB_RELEASES_URL,
      apkUrl: apkAsset?.browser_download_url || "",
    };
    return latestRelease;
  } catch (error) {
    console.warn("Update check failed:", error);
    return null;
  }
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
  const url = release?.apkUrl || release?.htmlUrl || GITHUB_RELEASES_URL;
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    window.location.href = url;
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
