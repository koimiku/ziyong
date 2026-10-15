import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
test("native episode selection routes valid indexes and keeps fullscreen on load", async () => {
  const listeners = new Map(), calls = [], picked = [];
  const api = {
    addListener(name, fn) { listeners.set(name, fn); return { remove() { listeners.delete(name); } }; },
    load(info) { calls.push(["load", info]); return Promise.resolve({ duration: 1200 }); },
    setInfo(info) { calls.push(["info", info]); return Promise.resolve(); },
    stop() { calls.push(["stop"]); return Promise.resolve(); },
    setFullscreen() { calls.push(["fullscreen"]); return Promise.resolve(); },
    setRect(info) { calls.push(["rect", info]); return Promise.resolve(); },
    setVisible(info) { calls.push(["visible", info]); return Promise.resolve(); },
  };
  const code = readFileSync(new URL("../client/native/native-player.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/, "").replaceAll("export function ", "function ");
  const frames = new Map(), windowEvents = new Map(), documentEvents = new Map(), observers = [];
  let overlay = null;
  let nextFrame = 0, clock = 0;
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const context = {
    window: { Capacitor: { Plugins: { NativePlayer: api } }, devicePixelRatio: 1, location: { href: "https://localhost/" }, addEventListener(name, fn) { windowEvents.set(name, fn); }, removeEventListener(name) { windowEvents.delete(name); } },
    document: { addEventListener(name, fn) { documentEvents.set(name, fn); }, removeEventListener(name) { documentEvents.delete(name); }, documentElement: { dataset: { theme: "dark" } }, body: { classList: { contains: () => false } }, querySelector: () => overlay, elementFromPoint: () => null },
    getComputedStyle: () => ({ getPropertyValue: () => "#d0b4f4" }),
    navigator: { userAgent: "test" }, EventTarget, Event, URL,
    ResizeObserver: Observer, MutationObserver: Observer, performance: { now: () => clock },
    requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id),
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  const frame = { isConnected: true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 180 }) };
  const media = context.createNativeVideo(frame, { onEpisode: index => picked.push(index) });
  const info = { title: "测试", episodes: ["01", "02", "特别篇"], episodeIndex: 1, hasNext: true };
  await media.attach({ url: "/video.mp4" }, 0, info);
  assert.deepEqual(calls[0][1].episodes, info.episodes);
  assert.equal(calls[0][1].episodeIndex, 1);
  assert.equal(frames.size, 1);
  function draw(now) {
    clock = now;
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(fn => fn(now));
  }
  draw(0);
  assert.equal(frames.size, 0, "stationary inline playback must leave no continuous frame loop");
  const geometryCalls = calls.filter(([name]) => name === "rect").length;
  windowEvents.get("scroll")();
  draw(16);
  assert.equal(frames.size, 1, "scrolling tracks intermediate positions");
  draw(600);
  assert.equal(frames.size, 0, "tracking stops after movement settles");
  assert.equal(calls.filter(([name]) => name === "rect").length, geometryCalls, "unchanged geometry does not cross native bridge");
  observers[0].callback();
  assert.equal(frames.size, 1, "resize invalidates static geometry");
  draw(700);
  overlay = {};
  observers[1].callback([{type: "childList", addedNodes: [{nodeType: 1}], removedNodes: []}]);
  draw(720);
  assert.equal(calls.filter(([name]) => name === "visible").at(-1)[1].visible, false, "a newly opened dialog hides the native surface");
  overlay = null;
  observers[1].callback([{type: "childList", addedNodes: [], removedNodes: [{nodeType: 1}]}]);
  draw(740);
  assert.equal(calls.filter(([name]) => name === "visible").at(-1)[1].visible, true);
  context.document.hidden = true;
  documentEvents.get("visibilitychange")();
  windowEvents.get("scroll")();
  assert.equal(frames.size, 0, "backgrounded playback schedules no layout work");
  context.document.hidden = false;
  documentEvents.get("visibilitychange")();
  assert.equal(frames.size, 1);
  listeners.get("fullscreen")({ value: true });
  assert.equal(frames.size, 0);
  listeners.get("lock")({ locked: true });
  assert.equal(context.exitNativeFullscreen(), true);
  assert.equal(calls.some(([name]) => name === "fullscreen"), false);
  listeners.get("lock")({ locked: false });
  listeners.get("episode")({ index: 2 });
  listeners.get("episode")({ index: -1 });
  listeners.get("episode")({ index: 0.5 });
  assert.deepEqual(picked, [2]);
  media.setInfo({ ...info, episodeIndex: 2, loading: true });
  await media.attach({ url: "/next.mp4" }, 0, { ...info, episodeIndex: 2 });
  assert.equal(calls.some(([name]) => name === "stop" || name === "fullscreen"), false);
  assert.equal(calls.find(([name]) => name === "info")[1].loading, true);
  assert.equal(frames.size, 0);
  listeners.get("fullscreen")({ value: false });
  assert.equal(frames.size, 1);
  media.stop();
  await Promise.resolve();
  assert.equal(listeners.size, 0);
  assert.equal(windowEvents.size, 0);
  assert.equal(observers.every(observer => observer.disconnected), true);
});
