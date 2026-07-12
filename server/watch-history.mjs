import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeJson } from "./utils.mjs";

let appRoot = process.cwd();
const MAX_ITEMS = 48;

export function setWatchHistoryRoot(root) {
  appRoot = root;
}

function historyPath() {
  return join(appRoot, "data", "watch-history.json");
}

function readHistory() {
  try {
    const file = historyPath();
    if (!existsSync(file)) return [];
    const payload = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(payload?.list) ? payload.list : Array.isArray(payload) ? payload : [];
  } catch {
    return [];
  }
}

function writeHistory(list) {
  const file = historyPath();
  mkdirSync(join(appRoot, "data"), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ list: list.slice(0, MAX_ITEMS), updatedAt: Date.now() }, null, 2),
    "utf8"
  );
}

function normalizeEntry(entry) {
  if (!entry?.id) return null;
  const id = String(entry.id);
  const partition =
    entry.partition === "tokusatsu" || id.startsWith("tz:") ? "tokusatsu" : "anime";
  return {
    ...entry,
    id,
    partition,
    watchedAt: Number(entry.watchedAt || Date.now()),
    progress: entry.progress || null,
  };
}

function mergeLists(localList = [], remoteList = []) {
  const map = new Map();
  [...remoteList, ...localList].forEach((raw) => {
    const entry = normalizeEntry(raw);
    if (!entry) return;
    const current = map.get(entry.id);
    if (!current) {
      map.set(entry.id, entry);
      return;
    }
    const currentTime = Math.max(
      Number(current.watchedAt || 0),
      Number(current.progress?.updatedAt || 0)
    );
    const nextTime = Math.max(
      Number(entry.watchedAt || 0),
      Number(entry.progress?.updatedAt || 0)
    );
    map.set(entry.id, nextTime >= currentTime ? entry : current);
  });

  return [...map.values()]
    .sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0))
    .slice(0, MAX_ITEMS);
}

export async function handleWatchHistoryGet(_url, response) {
  writeJson(response, 200, { list: readHistory() });
}

export async function handleWatchHistoryPut(request, response) {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const incoming = Array.isArray(body.list) ? body.list : [];
    const merged = mergeLists(incoming, readHistory());
    writeHistory(merged);
    writeJson(response, 200, { list: merged, ok: true });
  } catch (error) {
    writeJson(response, 400, { error: String(error?.message || error) });
  }
}
