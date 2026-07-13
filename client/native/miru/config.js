export const DEFAULT_MIRU_REPO = "https://miru-repo.0n0.dev";

export const DEFAULT_EXTENSIONS = [
  "360zy.com",
  "ffzy.tv",
  "lzzy.tv",
  "cycanime.com",
];

export const MIRU_SOURCE_PREFIX = "miru:";

export function miruSourceId(packageName) {
  return `${MIRU_SOURCE_PREFIX}${packageName}`;
}

export function parseMiruSourceId(sourceId) {
  const id = String(sourceId || "");
  if (!id.startsWith(MIRU_SOURCE_PREFIX)) return null;
  return id.slice(MIRU_SOURCE_PREFIX.length);
}
