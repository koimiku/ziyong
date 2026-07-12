import vm from "node:vm";
import { createElementClass, createXPathClass, querySelectorAllHtml, getAttributeText } from "./dom.mjs";
import { transformExtensionScript } from "./meta.mjs";

const settingsStore = new Map();

function getPackageSettings(packageName) {
  if (!settingsStore.has(packageName)) {
    settingsStore.set(packageName, new Map());
  }
  return settingsStore.get(packageName);
}

function joinMiruUrl(base, path) {
  const suffix = path == null ? "" : String(path);
  const prefix = base == null ? "" : String(base);
  if (!suffix) return prefix;
  if (/^https?:\/\//i.test(suffix)) return suffix;
  return prefix + suffix;
}

function createExtensionClass(meta) {
  const Element = createElementClass();
  const XPathNode = createXPathClass();

  return class Extension {
    package = meta.package;
    name = meta.name;
    settingKeys = [];

    querySelector(content, selector) {
      return new Element(content, selector);
    }

    queryXPath(content, selector) {
      return new XPathNode(content, selector);
    }

    async querySelectorAll(content, selector) {
      const htmlList = querySelectorAllHtml(content, selector);
      return htmlList.map((html) => new Element(html, selector));
    }

    async getAttributeText(content, selector, attr) {
      return getAttributeText(content, selector, attr);
    }

    async request(url, options = {}) {
      const opts = options || {};
      const headers = { ...(opts.headers || {}) };
      const miruUrl = headers["Miru-Url"] || headers["miru-url"] || meta.webSite || "";
      delete headers["Miru-Url"];
      delete headers["miru-url"];

      const method = String(opts.method || "get").toUpperCase();
      const fullUrl = joinMiruUrl(miruUrl, url);
      if (!fullUrl) {
        throw new Error("Miru request missing URL");
      }

      const init = { method, headers };
      if (opts.data != null && method !== "GET" && method !== "HEAD") {
        init.body =
          typeof opts.data === "string" || Buffer.isBuffer(opts.data)
            ? opts.data
            : JSON.stringify(opts.data);
        if (!headers["Content-Type"] && !headers["content-type"]) {
          headers["Content-Type"] = "application/json";
        }
      }

      const response = await fetch(fullUrl, init);
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    async getSetting(key) {
      const settings = getPackageSettings(meta.package);
      const item = settings.get(key);
      return item?.value ?? item?.defaultValue ?? "";
    }

    async registerSetting(settings) {
      const payload = settings || {};
      this.settingKeys.push(payload.key);
      const store = getPackageSettings(meta.package);
      if (!store.has(payload.key)) {
        store.set(payload.key, {
          value: payload.value ?? payload.defaultValue ?? "",
          defaultValue: payload.defaultValue ?? "",
          title: payload.title || payload.key,
          type: payload.type || "input",
        });
      }
      return true;
    }

    async load() {}

    latest() {
      throw new Error("not implement latest");
    }

    search() {
      throw new Error("not implement search");
    }

    createFilter() {
      throw new Error("not implement createFilter");
    }

    detail() {
      throw new Error("not implement detail");
    }

    watch() {
      throw new Error("not implement watch");
    }

    checkUpdate() {
      throw new Error("not implement checkUpdate");
    }
  };
}

export async function createExtensionRuntime(meta, script) {
  const Extension = createExtensionClass(meta);
  const sandbox = {
    Extension,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    JSON,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Date,
    Math,
    RegExp,
    Error,
    URL,
    URLSearchParams,
    encodeURI,
    decodeURI,
    encodeURIComponent,
    decodeURIComponent,
    atob: (value) => Buffer.from(String(value), "base64").toString("binary"),
    btoa: (value) => Buffer.from(String(value), "binary").toString("base64"),
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  sandbox.window = sandbox;

  const code = transformExtensionScript(script);
  const vmScript = new vm.Script(code, { filename: `${meta.package}.js` });
  vmScript.runInNewContext(sandbox, { timeout: 30_000 });

  const ExtClass = sandbox.__MiruExtensionClass;
  if (typeof ExtClass !== "function") {
    throw new Error(`Failed to load extension class: ${meta.package}`);
  }

  const instance = new ExtClass();
  if (typeof instance.load === "function") {
    await instance.load();
  }
  return instance;
}
