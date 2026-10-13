import { writeJson } from "../utils.mjs";
import {
  detailKazumi,
  ensureKazumiReady,
  fetchKazumiIndex,
  getKazumiRule,
  importKazumiRule,
  installKazumiRule,
  listKazumiRules,
  listKazumiSources,
  resolveKazumiPlay,
  searchKazumi,
  seedDefaultKazumiRules,
  uninstallKazumiRule,
} from "./store.mjs";

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("规则内容过大");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

export async function handleKazumiRepo(_url, response) {
  try {
    await ensureKazumiReady();
    const installed = new Set(listKazumiRules().map((item) => item.name));
    const list = (await fetchKazumiIndex()).map((item) => ({
      ...item,
      installed: installed.has(item.name),
    }));
    writeJson(response, 200, { list });
  } catch (error) {
    writeJson(response, 502, { error: String(error?.message || error) });
  }
}

export async function handleKazumiInstalled(_url, response) {
  await ensureKazumiReady().catch(() => {});
  writeJson(response, 200, { list: listKazumiRules() });
}

export async function handleKazumiSources(_url, response) {
  await ensureKazumiReady().catch(() => {});
  writeJson(response, 200, { list: listKazumiSources() });
}

export async function handleKazumiSeed(_url, response) {
  try {
    const result = await seedDefaultKazumiRules();
    writeJson(response, 200, { ok: true, ...result, sources: listKazumiSources() });
  } catch (error) {
    writeJson(response, 502, { error: String(error?.message || error) });
  }
}

export async function handleKazumiInstall(url, response) {
  const name = String(url.searchParams.get("name") || "").trim();
  if (!name) {
    writeJson(response, 400, { error: "Missing rule name" });
    return;
  }
  try {
    const rule = await installKazumiRule(name);
    writeJson(response, 200, { ok: true, rule, sources: listKazumiSources() });
  } catch (error) {
    writeJson(response, 502, { error: String(error?.message || error) });
  }
}

export async function handleKazumiImport(request, response) {
  try {
    const payload = await readJsonBody(request);
    const rule = await importKazumiRule(payload);
    writeJson(response, 200, { ok: true, rule, sources: listKazumiSources() });
  } catch (error) {
    writeJson(response, 400, { error: String(error?.message || error) });
  }
}

export async function handleKazumiUninstall(url, response) {
  const name = String(url.searchParams.get("name") || "").trim();
  if (!name) {
    writeJson(response, 400, { error: "Missing rule name" });
    return;
  }
  try {
    uninstallKazumiRule(name);
    writeJson(response, 200, { ok: true, sources: listKazumiSources() });
  } catch (error) {
    writeJson(response, 400, { error: String(error?.message || error) });
  }
}

export function hasKazumiRule(name) {
  return Boolean(name && getKazumiRule(name));
}

export {
  detailKazumi,
  ensureKazumiReady,
  listKazumiSources,
  resolveKazumiPlay,
  searchKazumi,
};
