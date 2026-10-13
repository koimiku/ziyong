let sniffer = null;

export function setMediaSniffer(fn) {
  sniffer = typeof fn === "function" ? fn : null;
}

export function hasMediaSniffer() {
  return Boolean(sniffer);
}

export async function sniffMedia(pageUrl, options = {}) {
  if (!sniffer) throw new Error("当前环境不支持网页解析");
  return sniffer(pageUrl, options);
}
