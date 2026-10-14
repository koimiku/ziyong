import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
const code = fs.readFileSync(new URL("../client/startup.js", import.meta.url), "utf8");
function boot(raw, broken = false) {
  const nodes = [];
  const timers = new Map();
  const fields = new Map();
  let ready;
  function element() {
    return { listeners: {}, append(...children) { this.children = children; }, setAttribute() {},
      removeAttribute() {}, remove() { this.removed = true; },
      addEventListener(name, fn) { this.listeners[name] = fn; } };
  }
  const document = {
    body: { append(node) { nodes.push(node); } },
    createElement: element,
    querySelector(selector) {
      if (selector === ".startup-screen") return nodes.find(n => !n.removed);
      if (!fields.has(selector)) fields.set(selector, element());
      return fields.get(selector);
    },
    addEventListener(name, fn) { ready = fn; },
  };
  const localStorage = {
    getItem() { if (broken) throw new Error(); return raw; },
    setItem(key, value) { if (broken) throw new Error(); raw = value; },
  };
  vm.runInNewContext(code, { document, localStorage,
    setTimeout(fn) { timers.set(fn, fn); return fn; }, clearTimeout(id) { timers.delete(id); } });
  return { nodes, timers, fields, ready, stored: () => JSON.parse(raw) };
}
test("default, disabled and corrupt preferences never delay startup", () => {
  for (const raw of [null, "{}", '{"enabled":false}', "null", "{"]) {
    const app = boot(raw);
    assert.equal(app.nodes.length, 0);
    assert.equal(app.timers.size, 0);
  }
  assert.equal(boot(null, true).nodes.length, 0);
});
test("custom image shows and always times out; skip also closes", () => {
  const app = boot('{"enabled":true,"image":"data:image/png;base64,AAAA"}');
  assert.equal(app.nodes[0].children[0].src, "data:image/png;base64,AAAA");
  [...app.timers.values()][0]();
  assert.equal(app.nodes[0].removed, true);
  const skip = boot('{"enabled":true}');
  skip.nodes[0].children[1].listeners.click();
  assert.equal(skip.nodes[0].removed, true);
  assert.equal(skip.timers.size, 0);
});
test("disabling keeps the chosen image and storage failure reverts toggle", () => {
  const app = boot('{"enabled":true,"image":"data:image/png;base64,AAAA"}');
  app.ready();
  const toggle = app.fields.get("#startupEnabled");
  toggle.checked = false;
  toggle.listeners.change();
  assert.equal(app.stored().enabled, false);
  assert.equal(app.stored().image, "data:image/png;base64,AAAA");
  const broken = boot(null, true);
  broken.ready();
  const failed = broken.fields.get("#startupEnabled");
  failed.checked = true;
  failed.listeners.change();
  assert.equal(failed.checked, false);
});