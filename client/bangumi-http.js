import { APP_VERSION } from "./version.js";
import { isAndroidStandalone } from "./native/install.js";

export const BANGUMI_API_ORIGIN = "https://api.bgm.tv";
export const BANGUMI_USER_AGENT = `ziyong/${APP_VERSION} (https://github.com/koimiku/ziyong)`;

function buildHeaders(extra = {}, token = "") {
  const headers = {
    Accept: "application/json",
    "User-Agent": BANGUMI_USER_AGENT,
    ...extra,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function requestNative(url, { method = "GET", headers = {}, body } = {}) {
  const Http = window.Capacitor?.Plugins?.CapacitorHttp;
  if (!Http?.request) throw new Error("CapacitorHttp unavailable");

  let data = body;
  if (typeof body === "string") {
    try {
      data = JSON.parse(body);
    } catch {
      data = body;
    }
  }

  const response = await Http.request({
    url,
    method,
    headers,
    data,
  });

  const status = Number(response?.status || 0);
  const raw = response?.data;
  const text =
    typeof raw === "string" ? raw : raw == null ? "" : JSON.stringify(raw);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (typeof raw === "object" && raw != null) return raw;
      return text ? JSON.parse(text) : null;
    },
    async text() {
      return text;
    },
  };
}

export async function bangumiRequest(path, { method = "GET", token = "", body, headers } = {}) {
  const apiPath = path.startsWith("http")
    ? path
    : isAndroidStandalone()
      ? `${BANGUMI_API_ORIGIN}${path}`
      : `/api/bangumi${path.startsWith("/") ? path : `/${path}`}`;

  const finalHeaders = buildHeaders(
    {
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    token
  );
  const payload = body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body);

  if (isAndroidStandalone()) {
    try {
      return await requestNative(apiPath, { method, headers: finalHeaders, body: payload });
    } catch (error) {
      console.warn("Bangumi CapacitorHttp failed, fallback fetch:", error);
    }
  }

  return fetch(apiPath, {
    method,
    headers: finalHeaders,
    body: payload,
    cache: "no-store",
  });
}
