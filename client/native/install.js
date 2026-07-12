import { handleNativeApi } from "./router.js";

export function isAndroidStandalone() {
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
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

  return true;
}
