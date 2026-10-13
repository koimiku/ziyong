import { canRunCaptcha } from "./captcha-flow.js";
import { runCaptchaDialog } from "./captcha-dialog.js";

// Rules with a Kazumi anti-crawler config are verified in-app through a hidden page;
// anything else falls back to showing the site itself — a desktop window in Electron,
// a WebView dialog on Android — whose cookies are shared with rule requests.
function nativeVerifier() {
  const plugin = window.Capacitor?.Plugins?.MediaSniffer;
  return typeof plugin?.verify === "function" ? plugin : null;
}

export function canVerifySite() {
  return typeof window.electronAPI?.verifySite === "function" || Boolean(nativeVerifier());
}

// Resolves true when the site was verified (or the user finished with the site
// window), false when the user backed out of the in-app dialog.
export async function verifySite(verify = {}) {
  const { verifyUrl, userAgent } = verify;
  if (!verifyUrl) throw new Error("缺少验证地址");
  if (canRunCaptcha(verify)) return runCaptchaDialog(verify);
  if (typeof window.electronAPI?.verifySite === "function") {
    await window.electronAPI.verifySite(verifyUrl, userAgent || "");
    return true;
  }
  const plugin = nativeVerifier();
  if (plugin) {
    await plugin.verify({ url: verifyUrl, userAgent: userAgent || "" });
    return true;
  }
  throw new Error("请在电脑版或安卓 App 中完成验证");
}
