import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHealthMonitor } from '../client/health-monitor.js';

test('cache, force refresh and concurrent deduplication', async () => {
  let calls = 0;
  const monitor = createHealthMonitor(async () => { calls++; return true; });
  const [a, b] = await Promise.all([monitor.check('a'), monitor.check('a', { force: true })]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  await monitor.check('a');
  assert.equal(calls, 1);
  await monitor.check('a', { force: true });
  assert.equal(calls, 2);
});
test('empty results remain unknown; consecutive failures recover', async () => {
  let mode = 'empty';
  const monitor = createHealthMonitor(async () => { if (mode === 'error') throw Error('503'); return mode === 'ok'; });
  assert.equal((await monitor.check('a')).status, 'unknown');
  mode = 'error';
  assert.equal((await monitor.check('a', { force: true })).status, 'suspect');
  assert.equal((await monitor.check('a', { force: true })).status, 'unavailable');
  mode = 'ok';
  assert.equal((await monitor.check('a', { force: true })).status, 'ok');
});
test('a hanging source times out and does not block the queue', async () => {
  const monitor = createHealthMonitor(id => id === 'hang' ? new Promise(() => {}) : true, { timeoutMs: 25, concurrency: 1 });
  const results = await monitor.checkAll(['hang', 'ok']);
  assert.equal(results[0].status, 'suspect');
  assert.match(results[0].error, /超时/);
  assert.equal(results[1].ok, true);
});
test('limits active probes and expires cache', async () => {
  let active = 0, peak = 0, calls = 0;
  const monitor = createHealthMonitor(async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10)); active--; return true;
  }, { concurrency: 2, ttlMs: 1 });
  await monitor.checkAll(['1', '2', '3', '4', '4']);
  assert.equal(peak, 2); assert.equal(calls, 4);
  await new Promise(resolve => setTimeout(resolve, 5));
  await monitor.check('1'); assert.equal(calls, 5);
});
