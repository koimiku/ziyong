const MOBILE_QUERY = "(max-width: 780px)";

let deferredInstallPrompt = null;
let installBannerDismissed = localStorage.getItem("anime-install-dismiss") === "1";

export function initializeMobileInstall() {
  const banner = document.querySelector("#mobileInstallBanner");
  const installButton = document.querySelector("#mobileInstallButton");
  const settingsInstallButton = document.querySelector("#settingsInstallButton");
  const dismiss = document.querySelector("#mobileInstallDismiss");
  if (!banner) return;

  const runInstall = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => {});
    deferredInstallPrompt = null;
    banner.hidden = true;
    updateInstallUi();
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallUi();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    banner.hidden = true;
    updateInstallUi();
  });

  installButton?.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      await runInstall();
      return;
    }
    import("./app-nav.js").then(({ setAppView }) => setAppView("settings"));
    document.querySelector("#mobileInstallGuide")?.scrollIntoView({ behavior: "smooth" });
  });

  settingsInstallButton?.addEventListener("click", runInstall);

  dismiss?.addEventListener("click", () => {
    installBannerDismissed = true;
    banner.hidden = true;
    try {
      localStorage.setItem("anime-install-dismiss", "1");
    } catch {
      // ignore private mode
    }
    updateInstallUi();
  });

  updateInstallUi();
}

function updateInstallUi() {
  const banner = document.querySelector("#mobileInstallBanner");
  const installButton = document.querySelector("#mobileInstallButton");
  const settingsInstallButton = document.querySelector("#settingsInstallButton");
  const guide = document.querySelector("#mobileInstallGuide");
  if (!banner) return;

  const mobile = window.matchMedia(MOBILE_QUERY).matches;
  const standalone = isStandaloneMode();
  const ios = isIosDevice();
  const dismissed = installBannerDismissed || localStorage.getItem("anime-install-dismiss") === "1";
  const canPrompt = Boolean(deferredInstallPrompt);

  if (!mobile || standalone || dismissed) {
    banner.hidden = true;
    return;
  }

  banner.hidden = !(canPrompt || ios);

  if (installButton) {
    installButton.hidden = !canPrompt && !ios;
    installButton.textContent = canPrompt ? "安装" : "查看方法";
  }

  if (settingsInstallButton) {
    settingsInstallButton.hidden = !canPrompt;
  }

  if (guide) {
    guide.querySelector(".install-guide-android")?.toggleAttribute("hidden", ios);
    guide.querySelector(".install-guide-ios")?.toggleAttribute("hidden", !ios);
    guide.querySelector(".install-guide-ready")?.toggleAttribute("hidden", !canPrompt);
  }
}

export function isStandaloneMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

export function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
