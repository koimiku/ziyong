// Opens a site's verification page in a real browser view whose cookies are shared
// with rule requests: a desktop window in Electron, a WebView dialog on Android.
function nativeVerifier() {
  const plugin = window.Capacitor?.Plugins?.MediaSniffer;
  return typeof plugin?.verify === "function" ? plugin : null;
}

export function canVerifySite() {
  return typeof window.electronAPI?.verifySite === "function" || Boolean(nativeVerifier());
}

export async function verifySite({ verifyUrl, userAgent } = {}) {
  if (!verifyUrl) throw new Error("缺少验证地址");
  if (typeof window.electronAPI?.verifySite === "function") {
    return window.electronAPI.verifySite(verifyUrl, userAgent || "");
  }
  const plugin = nativeVerifier();
  if (plugin) return plugin.verify({ url: verifyUrl, userAgent: userAgent || "" });
  throw new Error("请在电脑版或安卓 App 中完成验证");
}
