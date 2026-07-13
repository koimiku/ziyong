export function isAndroidStandalone() {
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

function resolveTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export async function syncAndroidStatusBar(theme = resolveTheme()) {
  if (!isAndroidStandalone()) return;
  const StatusBar = window.Capacitor?.Plugins?.StatusBar;
  if (!StatusBar) return;

  const dark = theme === "dark";
  const background = dark ? "#0B0D12" : "#F3F5F8";

  try {
    // Force a dedicated system bar area (not drawn under the WebView).
    await StatusBar.setOverlaysWebView?.({ overlay: false });
    await StatusBar.setBackgroundColor?.({ color: background });
    // DARK = dark icons for light bg; LIGHT = light icons for dark bg.
    await StatusBar.setStyle?.({ style: dark ? "LIGHT" : "DARK" });
    await StatusBar.show?.();
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
        const { handleNativeApi } = await import("./router.js");
        return handleNativeApi(input, init);
      }
    } catch {
      // fall through
    }
    return originalFetch(input, init);
  };

  const applyBar = () => void syncAndroidStatusBar();
  applyBar();
  // Bridge / theme may finish after first paint.
  window.setTimeout(applyBar, 120);
  window.setTimeout(applyBar, 600);
  document.addEventListener("anime:theme-changed", (event) => {
    void syncAndroidStatusBar(event.detail?.theme);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) applyBar();
  });

  return true;
}
