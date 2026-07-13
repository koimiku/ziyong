import { handleNativeApi } from "./router.js";

export function isAndroidStandalone() {
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

async function syncAndroidStatusBar(theme = document.documentElement.dataset.theme) {
  if (!isAndroidStandalone()) return;
  try {
    const StatusBar = window.Capacitor?.Plugins?.StatusBar;
    if (!StatusBar) return;
    await StatusBar.setOverlaysWebView?.({ overlay: false });
    await StatusBar.setStyle?.({
      style: theme === "dark" ? "LIGHT" : "DARK",
    });
    await StatusBar.setBackgroundColor?.({
      color: theme === "dark" ? "#121212" : "#ffffff",
    });
  } catch (error) {
    console.warn("StatusBar setup skipped:", error);
  }
}

export function installNativeApi() {
  if (!isAndroidStandalone()) return false;
  if (window.__animeNativeApiInstalled) return true;
  window.__animeNativeApiInstalled = true;

  document.documentElement.classList.add("is-android-app");
  document.body?.classList.add("is-android-app", "is-mobile");

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      const url = new URL(
        typeof input === "string" ? input : input.url,
        window.location.href
      );
      if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
        return handleNativeApi(input, init);
      }
    } catch {
      // fall through
    }
    return originalFetch(input, init);
  };

  void syncAndroidStatusBar();
  document.addEventListener("anime:theme-changed", (event) => {
    void syncAndroidStatusBar(event.detail?.theme);
  });

  return true;
}
