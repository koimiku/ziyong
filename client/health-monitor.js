// Shared by desktop/server and Android. Search health is not a playback guarantee.
export function createHealthMonitor(probe, { timeoutMs = 8000, ttlMs = 600000, concurrency = 3 } = {}) {
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let active = 0;
  function drain() {
    while (active < concurrency && queue.length) {
      active++;
      queue.shift()().finally(() => { active--; drain(); });
    }
  }
  function check(source, { force = false } = {}) {
    if (pending.has(source)) return pending.get(source);
    const previous = cache.get(source);
    if (!force && previous && Date.now() - previous.checkedAt < ttlMs) return Promise.resolve(previous);
    const promise = new Promise((resolve) => {
      queue.push(async () => {
        const started = Date.now();
        let timer;
        let result;
        try {
          const ok = await Promise.race([
            Promise.resolve().then(() => probe(source)),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error("检测超时，请稍后重试")), timeoutMs);
            }),
          ]);
          result = { ok: Boolean(ok), status: ok ? "ok" : "unknown",
            error: ok ? "" : "测试搜索无结果，暂不能判断片源是否失效", failures: 0 };
        } catch (error) {
          const failures = (previous?.failures || 0) + 1;
          const message = String(error?.message || error);
          result = { ok: false, status: failures >= 2 ? "unavailable" : "suspect", failures,
            error: /fetch failed|Failed to fetch|NetworkError/i.test(message)
              ? "网络连接失败，请检查网络或稍后重试" : message };
        } finally {
          clearTimeout(timer);
        }
        result = { ...result, source, latency: Date.now() - started, checkedAt: Date.now(), scope: "search" };
        cache.set(source, result);
        pending.delete(source);
        resolve(result);
      });
    });
    pending.set(source, promise);
    drain();
    return promise;
  }
  return { check, checkAll: (sources, options) => Promise.all([...new Set(sources)].map(source => check(source, options))) };
}
