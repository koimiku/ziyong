import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_EXTENSIONS, DEFAULT_MIRU_REPO, miruSourceId } from "./config.mjs";
import { parseExtensionMeta } from "./meta.mjs";
import { createExtensionRuntime } from "./runtime.mjs";

let appRoot = process.cwd();
const runtimes = new Map();
const metaByPackage = new Map();
let readyPromise = null;

export function setMiruRoot(root) {
  appRoot = root;
}

function extensionsDir() {
  return join(appRoot, "data", "miru", "extensions");
}

function ensureDirs() {
  mkdirSync(extensionsDir(), { recursive: true });
}

export function listInstalledMeta() {
  return [...metaByPackage.values()];
}

export function getRuntime(packageName) {
  return runtimes.get(packageName) || null;
}

export function getMeta(packageName) {
  return metaByPackage.get(packageName) || null;
}

export function getInstalledSources() {
  return listInstalledMeta()
    .filter((meta) => meta.type === "bangumi")
    .map((meta) => ({
      id: miruSourceId(meta.package),
      package: meta.package,
      name: meta.name,
      kind: "online",
      miru: true,
      icon: meta.icon,
      webSite: meta.webSite,
      version: meta.version,
      lang: meta.lang,
      searchUrl: (title) =>
        meta.webSite
          ? `${meta.webSite.replace(/\/$/, "")}/?q=${encodeURIComponent(title)}`
          : meta.webSite || "",
    }));
}

export async function ensureMiruReady(root = appRoot) {
  if (root) setMiruRoot(root);
  if (!readyPromise) {
    readyPromise = (async () => {
      ensureDirs();
      await loadInstalledFromDisk();
      if (!runtimes.size) {
        for (const packageName of DEFAULT_EXTENSIONS) {
          try {
            await installExtension(packageName);
          } catch (error) {
            console.warn(`[miru] default install failed: ${packageName}`, error?.message || error);
          }
        }
      }
    })();
  }
  return readyPromise;
}

async function loadInstalledFromDisk() {
  ensureDirs();
  runtimes.clear();
  metaByPackage.clear();

  const files = readdirSync(extensionsDir()).filter((name) => name.endsWith(".js"));
  for (const file of files) {
    const packageName = file.replace(/\.js$/i, "");
    try {
      await loadPackageFromDisk(packageName);
    } catch (error) {
      console.warn(`[miru] load failed: ${packageName}`, error?.message || error);
    }
  }
}

async function loadPackageFromDisk(packageName) {
  const filePath = join(extensionsDir(), `${packageName}.js`);
  const script = readFileSync(filePath, "utf8");
  const meta = parseExtensionMeta(script);
  if (meta.package !== packageName) {
    throw new Error(`Package mismatch: file=${packageName} meta=${meta.package}`);
  }
  const runtime = await createExtensionRuntime(meta, script);
  runtimes.set(packageName, runtime);
  metaByPackage.set(packageName, meta);
  return meta;
}

const REPO_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, options = {}, timeoutMs = REPO_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchRepoIndex(repoUrl = DEFAULT_MIRU_REPO) {
  const base = String(repoUrl || DEFAULT_MIRU_REPO).replace(/\/$/, "");
  const response = await fetchWithTimeout(`${base}/index.json`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "anime-miru-compat/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Miru repo failed: ${response.status}`);
  }
  const list = await response.json();
  return Array.isArray(list) ? list : [];
}

export async function installExtension(packageName, repoUrl = DEFAULT_MIRU_REPO) {
  ensureDirs();
  const index = await fetchRepoIndex(repoUrl);
  const entry = index.find((item) => item.package === packageName);
  if (!entry) {
    throw new Error(`Extension not found in repo: ${packageName}`);
  }
  if (entry.type && entry.type !== "bangumi") {
    throw new Error(`Only bangumi (video) extensions are supported: ${packageName}`);
  }

  const base = String(repoUrl || DEFAULT_MIRU_REPO).replace(/\/$/, "");
  const scriptUrl = entry.url?.startsWith("http")
    ? entry.url
    : `${base}/repo/${entry.url || `${packageName}.js`}`;

  const response = await fetchWithTimeout(scriptUrl, {
    headers: { "User-Agent": "anime-miru-compat/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Download failed: ${scriptUrl} (${response.status})`);
  }

  const script = await response.text();
  const meta = parseExtensionMeta(script);
  if (meta.package !== packageName) {
    throw new Error(`Package mismatch for ${packageName}`);
  }
  if (meta.type !== "bangumi") {
    throw new Error(`Only bangumi extensions are supported`);
  }

  const filePath = join(extensionsDir(), `${packageName}.js`);
  writeFileSync(filePath, script, "utf8");

  const runtime = await createExtensionRuntime(meta, script);
  runtimes.set(packageName, runtime);
  metaByPackage.set(packageName, meta);
  return meta;
}

export function uninstallExtension(packageName) {
  const filePath = join(extensionsDir(), `${packageName}.js`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
  runtimes.delete(packageName);
  metaByPackage.delete(packageName);
  return true;
}
