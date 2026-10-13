import {
  KAZUMI_RULES_INDEX,
  detailRule,
  kazumiSourceId,
  normalizeRule,
  resolveRulePlay,
  ruleFileName,
  ruleNeedsRefresh,
  ruleRawUrl,
  searchRule,
  seedDefaultRules,
} from "../../kazumi/engine.js";

const STORAGE_KEY = "anime-kazumi-rules-v1";
const SEED_KEY = "anime-kazumi-seeded-v1";
const LEGACY_MIRU_KEY = "anime-miru-extensions-v1";
const rules = new Map();
let readyPromise = null;
let seedPromise = null;

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore() {
  const payload = {};
  for (const [name, rule] of rules) payload[name] = rule;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export async function ensureKazumiReady() {
  if (!readyPromise) {
    readyPromise = Promise.resolve().then(() => {
      try {
        localStorage.removeItem(LEGACY_MIRU_KEY);
      } catch {
        // Storage can be unavailable; the legacy key is only reclaimed space.
      }
      rules.clear();
      for (const [name, stored] of Object.entries(readStore())) {
        try {
          const rule = normalizeRule(stored);
          rules.set(rule.name || name, rule);
        } catch (error) {
          console.warn(`[kazumi] load failed: ${name}`, error?.message || error);
        }
      }
      for (const rule of rules.values()) {
        if (!ruleNeedsRefresh(rule)) continue;
        installKazumiRule(rule.name).catch((error) => {
          console.warn(`[kazumi] refresh failed: ${rule.name}`, error?.message || error);
        });
      }
    });
  }
  return readyPromise;
}

export function getKazumiRule(name) {
  if (!name) return null;
  return rules.get(name) || null;
}

export function listKazumiRules() {
  return [...rules.values()].map(summarizeRule);
}

export function listKazumiSources() {
  return [...rules.values()]
    .filter((rule) => rule.type === "anime")
    .map((rule) => ({
      id: kazumiSourceId(rule.name),
      name: rule.name,
      version: rule.version,
      baseUrl: rule.baseUrl,
      searchMode: rule.searchMode,
      kind: "online",
      kazumi: true,
    }));
}

export async function fetchKazumiIndex() {
  const payload = JSON.parse(await requestText(KAZUMI_RULES_INDEX));
  if (!Array.isArray(payload)) throw new Error("规则索引格式无效");
  return payload.filter((item) => item && item.name);
}

export function seedDefaultKazumiRules() {
  if (!seedPromise) {
    seedPromise = runSeed().finally(() => {
      seedPromise = null;
    });
  }
  return seedPromise;
}

async function runSeed() {
  await ensureKazumiReady();
  if (localStorage.getItem(SEED_KEY)) return { ran: false, installed: 0, failed: [] };
  const { BUNDLED_KAZUMI_RULES } = await import("../../kazumi/bundled-rules.js");
  const index = await fetchKazumiIndex().catch((error) => {
    console.warn("[kazumi] rules index unavailable, using bundled rules", error?.message || error);
    return [];
  });
  const result = await seedDefaultRules({
    bundled: BUNDLED_KAZUMI_RULES,
    index,
    installedNames: new Set(rules.keys()),
    install: installKazumiRule,
    importRule: (rule) => importKazumiRule({ rule }),
  });
  localStorage.setItem(SEED_KEY, JSON.stringify({ seededAt: Date.now(), ...result }));
  return { ran: true, ...result };
}

export async function installKazumiRule(name) {
  await ensureKazumiReady();
  const fileName = ruleFileName(name);
  const rule = normalizeRule(await requestText(ruleRawUrl(fileName)));
  if (rule.name !== fileName) throw new Error(`规则名不一致: ${rule.name}`);
  rules.set(rule.name, rule);
  writeStore();
  return summarizeRule(rule);
}

export async function importKazumiRule(payload) {
  await ensureKazumiReady();
  let raw = payload?.json ?? payload?.rule;
  if (payload?.url) {
    const url = String(payload.url);
    if (!/^https?:\/\//i.test(url)) throw new Error("只接受 http(s) 规则地址");
    raw = await requestText(url);
  }
  const rule = normalizeRule(raw);
  rules.set(rule.name, rule);
  writeStore();
  return summarizeRule(rule);
}

export function uninstallKazumiRule(name) {
  const fileName = ruleFileName(name);
  rules.delete(fileName);
  writeStore();
}

export async function searchKazumi(name, keyword) {
  await ensureKazumiReady();
  return searchRule(requireRule(name), keyword, requestPrepared);
}

export async function detailKazumi(name, id) {
  await ensureKazumiReady();
  return detailRule(requireRule(name), id, requestPrepared);
}

export async function resolveKazumiPlay(name, watchUrl) {
  await ensureKazumiReady();
  return resolveRulePlay(requireRule(name), watchUrl, requestPrepared);
}

function requireRule(name) {
  const rule = getKazumiRule(name);
  if (!rule) throw new Error(`未安装 Kazumi 规则: ${name}`);
  return rule;
}

function summarizeRule(rule) {
  return {
    name: rule.name,
    version: rule.version,
    type: rule.type,
    baseUrl: rule.baseUrl,
    searchMode: rule.searchMode,
    chapterMode: rule.chapterMode,
  };
}

async function requestPrepared(prepared) {
  const cookie = await siteCookieHeader(prepared.url);
  return requestText(prepared.url, {
    method: prepared.method,
    headers: cookie ? { ...prepared.headers, Cookie: cookie } : prepared.headers,
    body: prepared.body,
  });
}

// Cookies the verification WebView collected live in the system cookie store.
async function siteCookieHeader(url) {
  const plugin = window.Capacitor?.Plugins?.MediaSniffer;
  if (typeof plugin?.cookies !== "function") return "";
  try {
    return String((await plugin.cookies({ url }))?.cookie || "");
  } catch {
    return "";
  }
}

async function requestText(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.headers,
    body: options.body,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = new Error(`上游请求失败: ${response.status}`);
    error.status = response.status;
    error.body = await response.text().catch(() => "");
    throw error;
  }
  return response.text();
}
