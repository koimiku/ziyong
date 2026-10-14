const KEY = "anime-collection";
export const COLLECTION_STATUSES = { planned: "想看", watching: "在看", completed: "看完" };
export function getCollection() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter(row => row?.id != null && COLLECTION_STATUSES[row.collectionStatus]) : [];
  } catch { return []; }
}
export function getCollectionStatus(id) {
  return getCollection().find(row => String(row.id) === String(id))?.collectionStatus || "";
}
export function setCollectionStatus(item, status) {
  if (item?.id == null || (status && !COLLECTION_STATUSES[status])) throw new Error("收藏状态无效");
  const list = getCollection().filter(row => String(row.id) !== String(item.id));
  if (status) {
    const fields = ["id", "title", "title_cn", "aliases", "displayType", "year", "score", "images", "synopsis", "tags", "episodes", "sourceUrl", "partition", "tokuzillaSlug"];
    const entry = Object.fromEntries(fields.filter(key => item[key] !== undefined).map(key => [key, item[key]]));
    list.unshift({ ...entry, collectionStatus: status, collectionUpdatedAt: Date.now() });
  }
  localStorage.setItem(KEY, JSON.stringify(list));
  document.dispatchEvent(new Event("anime:collection-changed"));
}