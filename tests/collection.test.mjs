import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
function store() {
  let raw;
  let blocked = false;
  const context = {
    Date, Event,
    localStorage: {
      getItem: () => raw ?? null,
      setItem(key, value) { if (blocked) throw new Error("quota"); raw = value; },
    },
    document: { dispatchEvent() {} },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL("../client/collection-store.js", import.meta.url), "utf8").replaceAll("export ", ""), context);
  return { ...context, corrupt(value) { raw = value; }, block() { blocked = true; } };
}
test("collection statuses replace an existing entry and support removal", () => {
  const s = store();
  const item = { id: 42, title: "番剧", title_cn: "测试", images: { large: "poster" }, unused: "not stored" };
  s.setCollectionStatus(item, "planned");
  assert.equal(s.getCollectionStatus("42"), "planned");
  s.setCollectionStatus(item, "watching");
  s.setCollectionStatus(item, "completed");
  assert.equal(s.getCollection().length, 1);
  assert.equal(s.getCollectionStatus(42), "completed");
  assert.equal(s.getCollection()[0].unused, undefined);
  s.setCollectionStatus(item, "");
  assert.equal(s.getCollection().length, 0);
});
test("malformed storage fails open; invalid status and quota failure do not lose previous data", () => {
  const s = store();
  s.corrupt("{");
  assert.equal(s.getCollection().length, 0);
  s.setCollectionStatus({ id: 1 }, "planned");
  assert.throws(() => s.setCollectionStatus({ id: 1 }, "invalid"));
  s.block();
  assert.throws(() => s.setCollectionStatus({ id: 1 }, "completed"));
  assert.equal(s.getCollectionStatus(1), "planned");
});