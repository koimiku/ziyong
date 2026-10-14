import { normalizeRule } from "./kazumi/engine.js";
export const BACKUP_SETTINGS = ["anime-theme","anime-palette-light","anime-palette-dark","anime-startup","anime-auto-health","anime-search-recent"];
export function validateBackup(value) {
  if (!value || value.format !== "anime-backup" || value.schema !== 1) throw new Error("不是受支持的 anime 备份");
  if (!Array.isArray(value.rules) || !Array.isArray(value.history) || !Array.isArray(value.collection)) throw new Error("备份数据不完整");
  if (value.rules.length > 1000 || value.history.length > 5000 || value.collection.length > 5000) throw new Error("备份条目过多");
  const rules = value.rules.map(normalizeRule);
  if (new Set(rules.map(rule=>rule.name)).size !== rules.length) throw new Error("备份含重复规则名称");
  const settings = {};
  for (const [key,data] of Object.entries(value.settings || {})) {
    if (!BACKUP_SETTINGS.includes(key) || typeof data !== "string") throw new Error("备份含不支持的设置");
    settings[key] = data;
  }
  const checkRows = rows => rows.map(row => {
    if (!row || !["string","number"].includes(typeof row.id)) throw new Error("备份条目无有效编号");
    return row;
  });
  return {...value,rules,settings,history:checkRows(value.history),collection:checkRows(value.collection)};
}
export function mergeBackupRows(local, remote, timeKey) {
  const map = new Map();
  for(const row of [...local,...remote]) {
    if(!row || row.id==null)continue;
    const previous=map.get(String(row.id));
    if(!previous || Number(row[timeKey] || 0)>=Number(previous[timeKey] || 0)) map.set(String(row.id),row);
  }
  return [...map.values()].sort((a,b)=>Number(b[timeKey]||0)-Number(a[timeKey]||0));
}