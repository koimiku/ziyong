const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isDesktop: true,
  platform: process.platform,
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  verifySite: (url, userAgent) => ipcRenderer.invoke("site:verify", { url, userAgent }),
  captchaOpen: (options) => ipcRenderer.invoke("captcha:open", options),
  captchaEval: (options) => ipcRenderer.invoke("captcha:eval", options),
  captchaClose: (options) => ipcRenderer.invoke("captcha:close", options),
  onMaximizedChange: (callback) => {
    if (typeof callback !== "function") return;
    ipcRenderer.on("window:maximized-changed", (_event, maximized) => {
      callback(Boolean(maximized));
    });
  },
});
