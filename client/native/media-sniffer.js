import { buildStreamPayload, nativeFetch } from "./shared.js";

const PROBE_TIMEOUT_MS = 8000;
const PAGE_TYPE = /html|json/i;

function sniffer() {
  return window.Capacitor?.Plugins?.MediaSniffer;
}

export function hasNativeSniffer() {
  return typeof sniffer()?.sniff === "function";
}

// A quick look at the first bytes tells a working link from a signed/expired one
// before the player spends its timeout on it. No Referer: the <video> element can't send one.
async function probeStream(stream) {
  const headers = {};
  const isHls = stream.type === "hls";
  if (!isHls) headers.Range = "bytes=0-1023";
  try {
    const response = await nativeFetch(stream.sourceUrl || stream.url, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    if (isHls) return (await response.text()).trimStart().startsWith("#EXTM3U");
    return !PAGE_TYPE.test(response.headers.get("content-type") || "");
  } catch {
    return false;
  }
}

export async function resolveWithSniffFallback(resolveStatic, pageUrl, referer) {
  let staticError = null;
  try {
    const stream = await resolveStatic();
    if (!hasNativeSniffer() || !pageUrl || !stream?.url) return stream;
    if (await probeStream(stream)) return stream;
  } catch (error) {
    staticError = error;
    if (!hasNativeSniffer() || !pageUrl) throw error;
  }
  try {
    const found = await sniffer().sniff({ url: pageUrl, referer: referer || "" });
    return buildStreamPayload(found.mediaUrl, found.pageUrl || pageUrl, found.headers || {});
  } catch (sniffError) {
    throw staticError || sniffError;
  }
}
