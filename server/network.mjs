import os from "node:os";

const VIRTUAL_INTERFACE_HINTS = [
  "vEthernet",
  "WSL",
  "Hyper-V",
  "VMware",
  "VirtualBox",
  "Docker",
  "Npcap",
  "Loopback",
  "TAP",
  "TUN",
];

function isIpv4(entry) {
  return entry?.family === "IPv4" || entry?.family === 4;
}

function isVirtualInterface(name) {
  const label = String(name || "");
  return VIRTUAL_INTERFACE_HINTS.some((hint) => label.includes(hint));
}

function scoreLanAddress(address) {
  if (address.startsWith("192.168.")) return 100;
  if (address.startsWith("10.")) return 80;
  if (address.startsWith("172.16.") || address.startsWith("172.17.")) return 10;
  if (address.startsWith("169.254.")) return 0;
  return 40;
}

export function getLanAddresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();

  for (const [name, entries] of Object.entries(interfaces)) {
    if (isVirtualInterface(name)) continue;
    for (const entry of entries || []) {
      if (!isIpv4(entry) || entry.internal) continue;
      addresses.push(entry.address);
    }
  }

  return [...new Set(addresses)].sort((a, b) => scoreLanAddress(b) - scoreLanAddress(a));
}

export function getPrimaryLanUrl(port, host = "127.0.0.1") {
  const lan = getLanAddresses();
  if (lan.length > 0) {
    return `http://${lan[0]}:${port}/`;
  }

  const urls = getServerUrls(port, host);
  return urls.find((url) => !url.includes("127.0.0.1") && !url.includes("localhost")) || "";
}

export function getServerUrls(port, host = "127.0.0.1") {
  const urls = [`http://127.0.0.1:${port}/`];

  if (host === "0.0.0.0" || host === "::") {
    getLanAddresses().forEach((address) => {
      urls.push(`http://${address}:${port}/`);
    });
  } else if (host !== "127.0.0.1" && host !== "localhost") {
    urls.push(`http://${host}:${port}/`);
  }

  return [...new Set(urls)];
}
