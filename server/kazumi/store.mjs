import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  setHtmlParser,
} from "../../client/kazumi/engine.js";
import { parseHtmlWithCheerio } from "./html.mjs";
import { siteCookieHeader } from "../site-cookies.mjs";

setHtmlParser(parseHtmlWithCheerio);

let appRoot = process.cwd();
const rules = new Map();
let readyPromise = null;
let seedPromise = null;

export function setKazumiRoot(root) {
  if (root && root !== appRoot) {
    appRoot = root;
    readyPromise = null;
    seedPromise = null;
    rules.clear();
  }
}

function rulesDir() {
  return join(appRoot, "data", "kazumi", "rules");
}

function seedFlagPath() {
  return join(appRoot, "data", "kazumi", "seeded.json");
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
  if (existsSync(seedFlagPath())) return { ran: false, installed: 0, failed: [] };
  const { BUNDLED_KAZUMI_RULES } = await import("../../client/kazumi/bundled-rules.js");
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
  mkdirSync(join(appRoot, "data", "kazumi"), { recursive: true });
  writeFileSync(seedFlagPath(), `${JSON.stringify({ seededAt: Date.now(), ...result })}\n`, "utf8");
  return { ran: true, ...result };
}

export async function ensureKazumiReady(root = appRoot) {
  if (root) setKazumiRoot(root);
  if (!readyPromise) {
    readyPromise = Promise.resolve().then(() => {
      mkdirSync(rulesDir(), { recursive: true });
      rules.clear();
      for (const file of readdirSync(rulesDir())) {
        if (!file.endsWith(".json")) continue;
        try {
          const rule = normalizeRule(JSON.parse(readFileSync(join(rulesDir(), file), "utf8")));
          rules.set(rule.name, rule);
        } catch (error) {
          console.warn(`[kazumi] load failed: ${file}`, error?.message || error);
        }
      }
      refreshIncompleteRules();
    });
  }
  return readyPromise;
}

function refreshIncompleteRules() {
  for (const rule of rules.values()) {
    if (!ruleNeedsRefresh(rule)) continue;
    installKazumiRule(rule.name).catch((error) => {
      console.warn(`[kazumi] refresh failed: ${rule.name}`, error?.message || error);
    });
  }
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

export async function installKazumiRule(name) {
  await ensureKazumiReady();
  const fileName = ruleFileName(name);
  const rule = normalizeRule(await requestText(ruleRawUrl(fileName)));
  if (rule.name !== fileName) {
    throw new Error(`规则名不一致: ${rule.name}`);
  }
  saveRule(rule);
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
  saveRule(rule);
  return summarizeRule(rule);
}

export function uninstallKazumiRule(name) {
  const fileName = ruleFileName(name);
  const filePath = join(rulesDir(), `${fileName}.json`);
  if (existsSync(filePath)) unlinkSync(filePath);
  rules.delete(fileName);
}

export async function searchKazumi(name, keyword) {
  const rule = requireRule(name);
  return searchRule(rule, keyword, requestPrepared);
}

export async function detailKazumi(name, id) {
  const rule = requireRule(name);
  return detailRule(rule, id, requestPrepared);
}

export async function resolveKazumiPlay(name, watchUrl) {
  const rule = requireRule(name);
  return resolveRulePlay(rule, watchUrl, requestPrepared);
}

function requireRule(name) {
  const rule = getKazumiRule(name);
  if (!rule) throw new Error(`未安装 Kazumi 规则: ${name}`);
  return rule;
}

function saveRule(rule) {
  mkdirSync(rulesDir(), { recursive: true });
  writeFileSync(join(rulesDir(), `${rule.name}.json`), `${JSON.stringify(rule, null, 2)}\n`, "utf8");
  rules.set(rule.name, rule);
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
