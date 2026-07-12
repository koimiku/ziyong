const DESKTOP_QUERY = "(min-width: 781px)";

import { fetchServerInfo, showServiceWarning } from "./server-api.js";

export async function initializeLanShare() {
  if (!window.matchMedia(DESKTOP_QUERY).matches) return;

  const openButton = document.querySelector("#lanShareOpen");
  openButton?.addEventListener("click", () => {
    openLanDialog().catch((error) => console.warn(error));
  });

  if (!isLocalDesktopClient()) return;

  const result = await fetchServerInfo();
  updateLanHint(result);
}

function isLocalDesktopClient() {
  const host = window.location.hostname;
  return host === "127.0.0.1" || host === "localhost";
}

function updateLanHint(result) {
  const hint = document.querySelector("#lanShareHint");
  if (!hint) return;
  if (!result.ok) {
    hint.textContent = result.message;
    if (result.stale) showServiceWarning(result.message);
    return;
  }
  const info = result.data;
  if (info.primaryLanUrl) {
    hint.textContent = "手机连同一 WiFi，点击按钮扫码打开。";
    return;
  }
  hint.textContent = info.mobileHint || "未检测到局域网地址，请确认电脑已联网。";
}

function applyQrImage(img, info, url) {
  if (!img) return;
  img.hidden = false;
  if (info?.qrDataUrl) {
    img.src = info.qrDataUrl;
  } else if (url) {
    img.src = `/api/server-qr?t=${Date.now()}`;
  } else {
    img.hidden = true;
  }
  img.alt = url ? `手机访问二维码：${url}` : "手机访问二维码";
}

async function openLanDialog() {
  const dialog = document.querySelector("#lanConnectDialog");
  const urlEl = document.querySelector("#lanConnectUrl");
  const qrImg = document.querySelector("#lanConnectQr");
  const tipEl = document.querySelector("#lanConnectTip");
  const copyButton = document.querySelector("#lanConnectCopy");
  const dismissButton = document.querySelector("#lanConnectDismiss");
  const backdrop = document.querySelector("#lanConnectBackdrop");
  if (!dialog || !urlEl || !qrImg) return;

  urlEl.textContent = "正在获取地址...";
  tipEl.textContent = "请稍候";
  applyQrImage(qrImg, null, "");
  showDialog(dialog, backdrop);

  const result = await fetchServerInfo();
  updateLanHint(result);

  if (!result.ok) {
    urlEl.textContent = result.message;
    tipEl.textContent = "关闭旧进程后重新打开 anime，再试一次。";
    copyButton.hidden = true;
    qrImg.hidden = true;
  } else {
    const info = result.data;
    const url = info.primaryLanUrl || "";
    if (!url) {
      urlEl.textContent = info.mobileHint || "未检测到局域网地址";
      tipEl.textContent = "请确认电脑已连接网络，且手机与电脑在同一 WiFi。";
      copyButton.hidden = true;
      qrImg.hidden = true;
    } else {
      urlEl.textContent = url;
      tipEl.textContent = "手机与电脑连同一 WiFi。电脑插网线没问题，手机用 WiFi 即可。";
      copyButton.hidden = false;
      applyQrImage(qrImg, info, url);
      copyButton.onclick = () => copyUrl(url, copyButton);
    }
  }

  dismissButton?.addEventListener(
    "click",
    () => closeDialog(dialog, backdrop),
    { once: true }
  );
  backdrop?.addEventListener(
    "click",
    () => closeDialog(dialog, backdrop),
    { once: true }
  );
}

function showDialog(dialog, backdrop) {
  dialog.classList.add("is-open");
  backdrop?.classList.add("is-open");
  document.body.classList.add("lan-dialog-open");
}

function closeDialog(dialog, backdrop) {
  dialog.classList.remove("is-open");
  backdrop?.classList.remove("is-open");
  document.body.classList.remove("lan-dialog-open");
}

async function copyUrl(url, button) {
  if (!button || !url) return;
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = "已复制";
    setTimeout(() => {
      button.textContent = "复制地址";
    }, 1500);
  } catch {
    button.textContent = "复制失败";
  }
}
