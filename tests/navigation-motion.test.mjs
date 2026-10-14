import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness(reduced = false) {
  let next = 0;
  const pending = new Map();
  const animations = [];
  const node = { hidden: false, classList: { toggle() {} }, toggleAttribute() {}, animate(frames, options) {
    const animation = { cancelled: false, cancel() { this.cancelled = true; } };
    animations.push(animation);
    return animation;
  } };
  const context = {
    appShell: node,
    document: { querySelector: () => node, querySelectorAll: () => [], body: { classList: { contains: () => false, toggle() {} } } },
    window: { matchMedia: query => ({ matches: query.includes('reduced-motion') && reduced }) },
    requestAnimationFrame: callback => { pending.set(++next, callback); return next; },
    cancelAnimationFrame: id => pending.delete(id),
  };
  const code = readFileSync(new URL('../client/app-nav.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/, '').replaceAll('export function ', 'function ');
  vm.createContext(context);
  vm.runInContext(code, context);
  return { go: context.setAppView, animations, pending, flush() {
    const tasks = [...pending.values()]; pending.clear(); tasks.forEach(callback => callback());
  } };
}

test('rapid navigation starts only the latest transition and cancels its predecessor', () => {
  const h = harness();
  h.go('explore'); h.go('miru'); h.go('settings');
  assert.equal(h.pending.size, 1);
  h.flush(); assert.equal(h.animations.length, 1);
  h.go('explore'); assert.equal(h.animations[0].cancelled, true);
  h.flush(); assert.equal(h.animations.length, 2);
  h.go('explore'); assert.equal(h.pending.size, 0);
});

test('reduced motion skips page animations', () => {
  const h = harness(true);
  h.go('explore'); h.go('settings'); h.flush();
  assert.equal(h.animations.length, 0);
});