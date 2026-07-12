export function pickDisplayTitle(item) {
  return item.title_cn || item.name_cn || item.title || item.name || "未命名番剧";
}

export function getBestMatchScore(query, aliases) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 0;

  return aliases.reduce((best, alias) => {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias) return best;
    if (normalizedAlias === normalizedQuery) return Math.max(best, 100);
    if (normalizedAlias.startsWith(normalizedQuery)) return Math.max(best, 92);
    if (normalizedAlias.includes(normalizedQuery)) return Math.max(best, 84);
    if (normalizedQuery.includes(normalizedAlias)) return Math.max(best, 78);
    const distance = levenshteinDistance(normalizedQuery, normalizedAlias);
    const longest = Math.max(normalizedQuery.length, normalizedAlias.length);
    const similarity = Math.round((1 - distance / longest) * 75);
    return Math.max(best, similarity);
  }, 0);
}

export function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s:：\-_,.。!！?？'"“”‘’()（）[\]【】]/g, "")
    .replace(/第二季|第2季|season2|s2/g, "2")
    .replace(/第三季|第3季|season3|s3/g, "3")
    .replace(/剧场版|movie/g, "");
}

export function levenshteinDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= b.length; column += 1) rows[0][column] = column;

  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + cost
      );
    }
  }

  return rows[a.length][b.length];
}

export function cleanSynopsis(text) {
  if (!text) return "暂无简介。";
  return text.trim();
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
