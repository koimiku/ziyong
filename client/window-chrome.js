function isElectronDesktop() {
  if (window.electronAPI?.isDesktop) return true;
  if (new URLSearchParams(window.location.search).get("desktop") === "1") return true;
  return /Electron/i.test(navigator.userAgent);
}

export function initializeWindowChrome() {
  if (!isElectronDesktop()) return;

  document.body.classList.add("is-electron");

  const titlebar = document.querySelector("#desktopTitlebar");
  if (!titlebar) return;

  titlebar.hidden = false;

  const api = window.electronAPI;
  const maximizeButton = titlebar.querySelector('[data-window="maximize"]');

  function syncMaximized(maximized) {
    document.body.classList.toggle("is-window-maximized", maximized);
    maximizeButton?.setAttribute("aria-label", maximized ? "还原" : "最大化");
  }

  titlebar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-window]");
    if (!button || !api) return;

    const action = button.dataset.window;
    if (action === "minimize") api.minimize();
    else if (action === "maximize") api.maximize();
    else if (action === "close") api.close();
  });

  titlebar.querySelector(".desktop-titlebar-drag")?.addEventListener("dblclick", () => {
    api?.maximize();
  });

  if (!api) {
    console.warn("[window-chrome] electronAPI unavailable; restart the desktop app.");
    return;
  }

  api.onMaximizedChange?.(syncMaximized);
  api.isMaximized?.().then(syncMaximized).catch(() => {});
}
