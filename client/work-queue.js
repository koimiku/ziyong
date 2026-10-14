export async function mapWithConcurrency(items, mapper, concurrency = 3) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  const limit = Math.max(1, Math.min(items.length, Math.floor(concurrency) || 1));
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}