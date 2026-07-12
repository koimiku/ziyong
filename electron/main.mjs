import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setAppRoot, startServer } from "../server.mjs";

const APP_PORT = Number(process.env.PORT || process.env.ANIME_PORT || 47890);
const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.join(ELECTRON_DIR, "preload.cjs");

let mainWindow = null;
let serverInfo = null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function resolveAppRoot() {
  if (app.isPackaged) {
    return app.getAppPath();
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function splashHtml() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: #eef3fb;
      color: #0f172a;
      font-family: "Microsoft YaHei", sans-serif;
      display: grid;
      place-items: center;
    }
    .box { text-align: center; }
    .mark {
      width: 72px;
      height: 72px;
      margin: 0 auto 18px;
      border-radius: 18px;
      display: grid;
      place-items: center;
      background: #2563eb;
      color: #fff;
      font-size: 34px;
      font-weight: 800;
    }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0; color: #64748b; }
  </style>
</head>
<body>
  <div class="box">
    <div class="mark">A</div>
    <h1>anime</h1>
    <p>正在启动...</p>
  </div>
</body>
</html>`)}`;
}

async function createWindow() {
  setAppRoot(resolveAppRoot());

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: "anime",
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#eef3fb",
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("[electron] preload failed:", preloadPath, error);
  });

  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:maximized-changed", true);
  });

  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:maximized-changed", false);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  await mainWindow.webContents.session.clearCache();
  await mainWindow.webContents.session.clearStorageData({
    storages: ["serviceworkers", "cachestorage"],
  });

  // Show splash immediately, then boot the local server.
  await mainWindow.loadURL(splashHtml());

  serverInfo = await startServer({
    port: APP_PORT,
    host: process.env.HOST || "0.0.0.0",
  });

  if (serverInfo.urls?.length > 1) {
    console.log("Phone access (same WiFi):");
    serverInfo.urls.slice(1).forEach((entry) => console.log(`  ${entry}`));
  }

  if (!mainWindow) return;
  const appUrl = `${serverInfo.url}?v=${Date.now()}&desktop=1`;
  mainWindow.setTitle(`anime · ${serverInfo.url}`);
  await mainWindow.loadURL(appUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function shutdown() {
  if (serverInfo?.server) {
    serverInfo.server.close();
    serverInfo = null;
  }
}

app.whenReady().then(() => {
  if (!gotTheLock) return;

  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });

  ipcMain.handle("window:maximize", () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    }
    mainWindow.maximize();
    return true;
  });

  ipcMain.handle("window:close", () => {
    mainWindow?.close();
  });

  ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);

  createWindow().catch((error) => {
    console.error(error);
    app.quit();
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  shutdown();
  app.quit();
});

app.on("before-quit", () => {
  shutdown();
});

app.on("activate", () => {
  if (!gotTheLock) return;
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => {
      console.error(error);
      app.quit();
    });
  }
});
