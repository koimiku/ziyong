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
  };
  const code = readFileSync(new URL("../client/native/native-player.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/, "").replaceAll("export function ", "function ");
  const frames = new Set();
  const context = {
    window: { Capacitor: { Plugins: { NativePlayer: api } }, devicePixelRatio: 1, location: { href: "https://localhost/" } },
    document: { addEventListener() {}, removeEventListener() {}, documentElement: { dataset: { theme: "dark" } } },
    getComputedStyle: () => ({ getPropertyValue: () => "#d0b4f4" }),
    navigator: { userAgent: "test" }, EventTarget, Event, URL,
    requestAnimationFrame: () => { frames.add(1); return 1; }, cancelAnimationFrame: id => frames.delete(id),
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
});