import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { mapWithConcurrency } from "../client/work-queue.js";

test("feed loading respects concurrency while retaining order and all results", async () => {
  let active = 0, peak = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], async value => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 8 - value));
    active--;
    return value * 2;
  }, 3);
  assert.equal(peak, 3);
  assert.deepEqual(result, [2, 4, 6, 8, 10, 12]);
});

function harness() {
  const requests = new Map(), nodes = new Map(), renders = [];
  const listeners = new Map();
  let watching = false;
  const node = selector => ({
    textContent: "", value: "", busy: false,
    classList: { contains: () => selector === ".app-shell" && watching, toggle() {}, remove() {}, add() {} },
    setAttribute(name) { if (name === "aria-busy") this.busy = true; },
    removeAttribute(name) { if (name === "aria-busy") this.busy = false; },
    toggleAttribute() {},
  });
  const context = {
    console, fallbackAnime: [], mapWithConcurrency,
    document: {
      hidden: false,
      querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node(selector)); return nodes.get(selector); },
      querySelectorAll: () => [],
      addEventListener(name, fn) { listeners.set(name, fn); },
    },
    state: { query: "", contentMode: "anime", exploreItems: [], searchItems: [] },
    pageTitle: node(), resultsGrid: node(),
    isTokusatsuMode: () => false,
    setSearchMode() {}, syncExplorePanels() {},
    getQueryCandidates: query => [query],
    fetchAnimeSearch(query) { return new Promise((resolve, reject) => requests.set(query, { resolve, reject })); },
    mergeAnimeResults: items => items,
    renders,
  };
  const code = readFileSync(new URL("../client/results.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from\s+"[^"]+";\r?\n/gm, "")
    .replaceAll("export async function ", "async function ").replaceAll("export function ", "function ");
  vm.createContext(context);
  vm.runInContext(code, context);
  return {
    context, requests, nodes, renders,
    setWatching(value) { watching = value; },
    mockRender() { vm.runInContext("renderResults = () => renders.push(state.query)", context); },
  };
}

test("late search results cannot replace newer search or clear its busy state", async () => {
  const h = harness();
  h.mockRender();
  const first = h.context.runSearch("old");
  const second = h.context.runSearch("new");
  h.requests.get("old").resolve([{ id: 1 }]);
  await first;
  assert.equal(h.context.resultsGrid.busy, true);
  assert.equal(h.context.state.searchItems.length, 0);
  h.requests.get("new").resolve([{ id: 2 }]);
  await second;
  assert.equal(h.context.state.searchItems[0].id, 2);
  assert.equal(h.context.resultsGrid.busy, false);
  assert.deepEqual(h.renders, ["new"]);
});

test("returning home invalidates pending searches, including failures", async () => {
  const h = harness();
  h.mockRender();
  const pending = h.context.runSearch("old");
  h.context.clearSearch();
  h.requests.get("old").reject(new Error("late network failure"));
  await pending;
  assert.equal(h.context.state.query, "");
  assert.equal(h.context.state.searchItems.length, 0);
  assert.deepEqual(h.renders, [""]);
});

test("history render does no catalog or DOM work while watching or backgrounded", () => {
  const h = harness();
  h.setWatching(true);
  assert.doesNotThrow(() => h.context.renderResults());
  h.setWatching(false);
  h.context.document.hidden = true;
  assert.doesNotThrow(() => h.context.renderResults());
  assert.equal(h.context.pageTitle.textContent, "");
});