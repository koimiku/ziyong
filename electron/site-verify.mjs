import { BrowserWindow } from "electron";

const WINDOW_TITLE = "网站验证 · 完成后关闭此窗口，anime 会自动重新检索";

// Shows the site in a normal window so the user can pass its captcha. The window
// shares the sniffer session, so both rule requests and page sniffing reuse the
// cookies the site issues afterwards.
export function createSiteVerifier(ses) {
  let current = null;

  async function cookieHeader(url) {
    const cookies = await ses.cookies.get({ url });
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  function open(parent, { url, userAgent } = {}) {
    if (!/^https?:\/\//i.test(String(url || ""))) {
      return Promise.reject(new Error("验证地址无效"));
    }
    if (current && !current.win.isDestroyed()) {
      current.win.focus();
      return current.done;
    }

    const win = new BrowserWindow({
      parent: parent || undefined,
      width: 1000,
      height: 760,
      title: WINDOW_TITLE,
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const contents = win.webContents;
    if (userAgent) contents.setUserAgent(userAgent);
    contents.setWindowOpenHandler(({ url: next }) => {
      if (/^https?:\/\//i.test(next)) contents.loadURL(next).catch(() => {});
      return { action: "deny" };
    });
    win.on("page-title-updated", (event) => event.preventDefault());

    const done = new Promise((resolve) => {
      win.on("closed", () => {
        current = null;
        ses.cookies.flushStore().catch(() => {}).finally(() => resolve(true));
      });
    });
    current = { win, done };
    win.loadURL(url).catch(() => {});
    return done;
  }

  return { open, cookieHeader };
}
