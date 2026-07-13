import { DEFAULT_EXTENSIONS, DEFAULT_MIRU_REPO, miruSourceId } from "./config.js";
import { parseExtensionMeta } from "./meta.js";
import { createExtensionRuntime } from "./runtime.js";

const STORAGE_KEY = "anime-miru-extensions-v1";
const runtimes = new Map();
const metaByPackage = new Map();
let readyPromise = null;

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
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

export async function ensureMiruReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await loadInstalledFromStore();
      if (!runtimes.size) {
        for (const packageName of DEFAULT_EXTENSIONS) {
          try {
            await installExtension(packageName);
          } catch (error) {
            console.warn(`[miru] default install failed: ${packageName}`, error?.message || error);
          }
        }
      }
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

async function loadInstalledFromStore() {
  runtimes.clear();
  metaByPackage.clear();
  const store = readStore();
  for (const [packageName, script] of Object.entries(store)) {
    try {
      await loadPackageScript(packageName, script);
    } catch (error) {
      console.warn(`[miru] load failed: ${packageName}`, error?.message || error);
    }
  }
}

async function loadPackageScript(packageName, script) {
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
      "User-Agent": "anime-miru-android/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Miru repo failed: ${response.status}`);
  }
  const list = await response.json();
  return Array.isArray(list) ? list : [];
}

export async function installExtension(packageName, repoUrl = DEFAULT_MIRU_REPO) {
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
    headers: { "User-Agent": "anime-miru-android/1.0" },
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

  const store = readStore();
  store[packageName] = script;
  writeStore(store);

  const runtime = await createExtensionRuntime(meta, script);
  runtimes.set(packageName, runtime);
  metaByPackage.set(packageName, meta);
  return meta;
}

export function uninstallExtension(packageName) {
  const store = readStore();
  delete store[packageName];
  writeStore(store);
  runtimes.delete(packageName);
  metaByPackage.delete(packageName);
  return true;
}
