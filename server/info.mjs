import { readFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { writeJson } from "./utils.mjs";
import { getLanAddresses, getPrimaryLanUrl, getServerUrls } from "./network.mjs";

let appVersion = "dev";

try {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  appVersion = pkg.version || appVersion;
} catch {
  // keep default
}

let serverPort = 47890;
let serverHost = "127.0.0.1";

export function setServerInfo({ port, host }) {
  if (port) serverPort = port;
  if (host) serverHost = host;
}

export async function handleServerInfo(_url, response) {
  const lan = getLanAddresses();
  const primaryLanUrl = getPrimaryLanUrl(serverPort, serverHost);
  let qrDataUrl = "";
  if (primaryLanUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(primaryLanUrl, {
        width: 280,
        margin: 1,
        color: { dark: "#261d22", light: "#ffffff" },
      });
    } catch {
      qrDataUrl = "";
    }
  }
  writeJson(response, 200, {
    version: appVersion,
    port: serverPort,
    host: serverHost,
    lan,
    primaryLanUrl,
    qrDataUrl,
    urls: getServerUrls(serverPort, serverHost),
    mobileHint:
      lan.length > 0
        ? `手机与电脑连同一 WiFi，浏览器打开 ${primaryLanUrl || `http://${lan[0]}:${serverPort}/`} ，可添加到主屏幕。`
        : "未检测到局域网地址。请确认电脑已连接网络，并用 0.0.0.0 启动服务。",
  });
}

export async function handleServerQr(_url, response) {
  const target = getPrimaryLanUrl(serverPort, serverHost);
  if (!target) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("No LAN URL");
    return;
  }

  try {
    const png = await QRCode.toBuffer(target, {
      type: "png",
      width: 280,
      margin: 1,
      color: { dark: "#261d22", light: "#ffffff" },
    });
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    });
    response.end(png);
  } catch (error) {
    response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(String(error?.message || error));
  }
}
