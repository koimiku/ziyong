export const APP_VERSION = "1.0.3";
export const APP_PORT = 47890;

export async function fetchServerInfo() {
  try {
    const response = await fetch("/api/server-info", { cache: "no-store" });
    if (response.status === 404) {
      return {
        ok: false,
        stale: true,
        message:
          "检测到旧版后台占用端口。请关闭所有 anime 窗口，并在任务管理器结束多余的 node.exe，然后重新打开。",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        message: `本地服务异常 (${response.status})，请重新启动 anime。`,
      };
    }
    const data = await response.json();
    if (data?.mode === "android-standalone") {
      return { ok: true, data, standalone: true };
    }
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      message: "无法连接本地服务，请重新启动 anime。",
    };
  }
}

export function showServiceWarning(message) {
  const banner = document.querySelector("#serviceWarning");
  if (!banner || !message) return;
  banner.textContent = message;
  banner.hidden = false;
}

export function hideServiceWarning() {
  const banner = document.querySelector("#serviceWarning");
  if (!banner) return;
  banner.hidden = true;
  banner.textContent = "";
}
