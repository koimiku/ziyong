import { BrowserWindow } from "electron";

const EVAL_TIMEOUT_MS = 4000;

// Hidden browser pages for Kazumi-style verification: the renderer drives them with
// small scripts, and they share the sniffer session so the cookies a site issues
// after the captcha are reused by rule requests.
export function createCaptchaPages(ses) {
  const pages = new Map();
  let seq = 0;

  async function clearSiteCookies(url) {
    const cookies = await ses.cookies.get({ url }).catch(() => []);
    await Promise.all(
      cookies.map((cookie) => {
        const host = String(cookie.domain || "").replace(/^\./, "");
        const target = `${cookie.secure ? "https" : "http"}://${host}${cookie.path || "/"}`;
        return ses.cookies.remove(target, cookie.name).catch(() => {});
      })
    );
  }

  async function open({ url, userAgent } = {}) {
    if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("验证地址无效");
    await clearSiteCookies(url);
    const win = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const contents = win.webContents;
    contents.setAudioMuted(true);
    if (userAgent) contents.setUserAgent(userAgent);
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-prevent-unload", (event) => event.preventDefault());

    const id = String(++seq);
    pages.set(id, win);
    win.on("closed", () => pages.delete(id));
    win.loadURL(url).catch(() => {});
    return { id };
  }

  async function evaluate({ id, script } = {}) {
    const win = pages.get(String(id));
    if (!win || win.isDestroyed()) throw new Error("验证页面已关闭");
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("验证页面没有响应")), EVAL_TIMEOUT_MS);
    });
    try {
      const value = await Promise.race([win.webContents.executeJavaScript(String(script || ""), true), timeout]);
      return { value };
    } finally {
      clearTimeout(timer);
    }
  }

  async function close({ id } = {}) {
    const win = pages.get(String(id));
    pages.delete(String(id));
    if (win && !win.isDestroyed()) win.destroy();
    await ses.cookies.flushStore().catch(() => {});
  }

  return { open, evaluate, close };
}
