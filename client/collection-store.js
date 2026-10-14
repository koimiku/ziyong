const KEY = "anime-collection";
export const COLLECTION_STATUSES = { planned: "想看", watching: "在看", completed: "看过" };
function readRows() {
  try { const list = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(list) ? list.filter(row => row?.id != null).map(row =>
      row.collectionPending === undefined && COLLECTION_STATUSES[row.collectionStatus] ? { ...row, collectionPending: true } : row) : []; }
  catch { return []; }
}
function saveRows(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
  document.dispatchEvent(new Event("anime:collection-changed"));
}
export function getCollection() { return readRows().filter(row => COLLECTION_STATUSES[row.collectionStatus]); }
export function getCollectionStatus(id) { return getCollection().find(row => String(row.id) === String(id))?.collectionStatus || ""; }
export function setCollectionStatus(item, status) {
  if (item?.id == null || (status && !COLLECTION_STATUSES[status])) throw new Error("收藏状态无效");
  const list = readRows().filter(row => String(row.id) !== String(item.id));
  const fields = ["id", "title", "title_cn", "aliases", "displayType", "year", "score", "images", "synopsis", "tags", "episodes", "sourceUrl", "partition", "tokuzillaSlug"];
  const entry = Object.fromEntries(fields.filter(key => item[key] !== undefined).map(key => [key, item[key]]));
  list.unshift({ ...entry, collectionStatus: status, collectionUpdatedAt: Date.now(), collectionPending: Boolean(status), collectionExcluded: !status });
  saveRows(list);
}
export function getPendingCollections() { return getCollection().filter(row => row.collectionPending && /^\d+$/.test(String(row.id))); }
export function acknowledgeCollection(entry) {
  const rows = readRows();
  const row = rows.find(item => String(item.id) === String(entry.id));
  if (!row || row.collectionStatus !== entry.collectionStatus || row.collectionUpdatedAt !== entry.collectionUpdatedAt) return;
  row.collectionPending = false;
  row.collectionRemote = true;
  saveRows(rows);
}
export function mergeBangumiCollections(entries) {
  const rows = readRows();
  const remote = new Map(entries.map(item => [String(item.id), item]));
  const local = new Map(rows.map(item => [String(item.id), item]));
  for (const entry of entries) {
    const previous = local.get(String(entry.id));
    if (previous?.collectionPending || previous?.collectionExcluded) continue;
    local.set(String(entry.id), { ...previous, ...entry, collectionPending: false });
  }
  // Remote removals only remove entries previously acknowledged by Bangumi.
  for (const row of rows) {
    if (row.collectionRemote && !row.collectionPending && !row.collectionExcluded && !remote.has(String(row.id))) local.delete(String(row.id));
  }
  saveRows([...local.values()]);
}