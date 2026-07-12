import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ELECTRON_DIR = join(ROOT, "node_modules", "electron");
const FORCE = process.argv.includes("--force");
const MIRROR =
  process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/";

function platformBinary() {
  if (process.platform === "win32") return "electron.exe";
  if (process.platform === "darwin") {
    return "Electron.app/Contents/MacOS/Electron";
  }
  return "electron";
}

function resolveElectronPath() {
  const binary = platformBinary();
  const pathFile = join(ELECTRON_DIR, "path.txt");
  if (existsSync(pathFile)) {
    const relative = readFileSync(pathFile, "utf8").trim();
    const candidate = join(ELECTRON_DIR, "dist", relative);
    if (existsSync(candidate)) return candidate;
  }
  const fallback = join(ELECTRON_DIR, "dist", binary);
  return existsSync(fallback) ? fallback : null;
}

function isHealthy() {
  if (FORCE) return false;
  if (!existsSync(join(ELECTRON_DIR, "package.json"))) return false;
  const electronPath = resolveElectronPath();
  if (!electronPath) return false;
  try {
    const result = spawnSync(electronPath, ["--version"], {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    return (
      result.status === 0 &&
      /v?\d+\.\d+/.test(String(result.stdout || result.stderr || ""))
    );
  } catch {
    return false;
  }
}

function runInstallScript() {
  const installJs = join(ELECTRON_DIR, "install.js");
  if (!existsSync(installJs)) {
    throw new Error("未找到 electron 包，请先执行 npm install");
  }

  const result = spawnSync(process.execPath, [installJs], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_MIRROR: MIRROR,
      force_no_cache: FORCE ? "true" : process.env.force_no_cache,
    },
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status === 0;
}

async function extractFromCache() {
  const pkg = JSON.parse(readFileSync(join(ELECTRON_DIR, "package.json"), "utf8"));
  const version = pkg.version;
  const platform = process.platform === "win32" ? "win32" : process.platform;
  const arch =
    process.arch === "ia32" ? "ia32" : process.arch === "arm64" ? "arm64" : "x64";
  const zipName = `electron-v${version}-${platform}-${arch}.zip`;

  const cacheRoot = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "electron", "Cache")
    : join(process.env.HOME || ROOT, ".cache", "electron");

  let zipPath = null;
  if (existsSync(cacheRoot)) {
    for (const entry of readdirSync(cacheRoot)) {
      const dir = join(cacheRoot, entry);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      const candidate = join(dir, zipName);
      if (existsSync(candidate)) {
        zipPath = candidate;
        break;
      }
    }
  }

  if (!zipPath) {
    const url = `${MIRROR.replace(/\/?$/, "/")}v${version}/${zipName}`;
    const downloadDir = join(cacheRoot, "manual-download");
    mkdirSync(downloadDir, { recursive: true });
    zipPath = join(downloadDir, zipName);
    console.log(`[electron] 正在下载 ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`下载 Electron 失败: HTTP ${response.status}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));
  }

  const distDir = join(ELECTRON_DIR, "dist");
  mkdirSync(distDir, { recursive: true });

  if (process.platform === "win32") {
    const ps = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${distDir.replace(/'/g, "''")}' -Force`,
      ],
      { encoding: "utf8", windowsHide: true }
    );
    if (ps.status !== 0) {
      throw new Error(ps.stderr || ps.stdout || "解压 Electron 失败");
    }
  } else {
    const unzip = spawnSync("unzip", ["-o", zipPath, "-d", distDir], {
      encoding: "utf8",
    });
    if (unzip.status !== 0) {
      throw new Error(unzip.stderr || "解压 Electron 失败");
    }
  }

  writeFileSync(join(ELECTRON_DIR, "path.txt"), platformBinary(), "utf8");
  writeFileSync(join(distDir, "version"), version, "utf8");
}

export async function ensureElectron() {
  if (isHealthy()) {
    const electronPath = resolveElectronPath();
    console.log(`[electron] OK ${electronPath}`);
    return electronPath;
  }

  console.log("[electron] 检测到安装不完整，正在修复...");

  if (!existsSync(join(ELECTRON_DIR, "package.json"))) {
    console.log("[electron] 正在安装 npm 包...");
    const npm = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "electron", "--save-dev"],
      {
        cwd: ROOT,
        env: { ...process.env, ELECTRON_MIRROR: MIRROR },
        encoding: "utf8",
        windowsHide: true,
        shell: true,
      }
    );
    if (npm.status !== 0) {
      throw new Error(npm.stderr || "npm install electron 失败");
    }
  }

  runInstallScript();
  if (isHealthy()) {
    const electronPath = resolveElectronPath();
    console.log(`[electron] 已修复 ${electronPath}`);
    return electronPath;
  }

  console.log("[electron] 官方安装脚本未完成，尝试手动解压...");
  await extractFromCache();

  if (!isHealthy()) {
    throw new Error("Electron 修复失败。请检查网络后执行: npm run fix:electron");
  }

  const electronPath = resolveElectronPath();
  console.log(`[electron] 已修复 ${electronPath}`);
  return electronPath;
}

const isDirectRun =
  process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isDirectRun) {
  ensureElectron()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error?.message || error);
      process.exit(1);
    });
}
