/**
 * Reads Kazumi-style JSON rules (XPath or JSON API) and turns them into
 * search results, episode lists, and a direct media URL when the page exposes one.
 * This is an independent reader for that JSON format.
 */

export const KAZUMI_SOURCE_PREFIX = "kazumi:";
export const KAZUMI_RULES_REPO = "https://raw.githubusercontent.com/Predidit/KazumiRules/main";
export const KAZUMI_RULES_INDEX = `${KAZUMI_RULES_REPO}/index.json`;

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let parseHtmlImpl = parseHtmlWithDom;

export function setHtmlParser(parser) {
  parseHtmlImpl = typeof parser === "function" ? parser : parseHtmlWithDom;
}

export function kazumiSourceId(name) {
  return `${KAZUMI_SOURCE_PREFIX}${name}`;
}

export function parseKazumiSourceId(sourceId) {
  const id = String(sourceId || "");
  if (!id.startsWith(KAZUMI_SOURCE_PREFIX)) return null;
  const name = id.slice(KAZUMI_SOURCE_PREFIX.length);
  return name || null;
}

export function ruleFileName(name) {
  const clean = String(name || "").trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(clean)) {
    throw new Error("规则名无效");
  }
  return clean;
}

export function ruleRawUrl(name, repo = KAZUMI_RULES_REPO) {
  return `${String(repo).replace(/\/$/, "")}/${encodeURIComponent(ruleFileName(name))}.json`;
}

export function isDefaultRuleCandidate(item) {
  return Boolean(item?.name) && (!item.type || item.type === "anime");
}

export async function seedDefaultRules({
  bundled = [],
  index = [],
  installedNames,
  install,
  importRule,
  limit = 4,
}) {
  const failed = [];
  let installed = 0;
  for (const raw of bundled) {
    if (!isDefaultRuleCandidate(raw) || installedNames.has(raw.name)) continue;
    try {
      await importRule(raw);
      installedNames.add(raw.name);
      installed += 1;
    } catch (error) {
      console.warn(`[kazumi] bundled rule failed: ${raw?.name}`, error?.message || error);
    }
  }
  const names = index
    .filter(isDefaultRuleCandidate)
    .map((item) => item.name)
    .filter((name) => !installedNames.has(name));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, names.length) }, async () => {
    while (cursor < names.length) {
      const name = names[cursor];
      cursor += 1;
      try {
        await install(name);
        installed += 1;
      } catch (error) {
        failed.push(name);
        console.warn(`[kazumi] default rule failed: ${name}`, error?.message || error);
      }
    }
  });
  await Promise.all(workers);
  return { installed, failed };
}

export function normalizeRule(input) {
  const json = typeof input === "string" ? JSON.parse(input) : input;
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("规则不是 JSON 对象");
  }
  const name = ruleFileName(json.name);
  const searchMode = json.searchMode === "api" ? "api" : "xpath";
  const chapterMode = json.chapterMode === "api" ? "api" : "xpath";
  const rule = {
    name,
    version: String(json.version || ""),
    type: String(json.type || "anime"),
    baseUrl: String(json.baseURL || json.baseUrl || ""),
    referer: String(json.referer || ""),
    userAgent: String(json.userAgent || ""),
    usePost: Boolean(json.usePost),
    searchMode,
    chapterMode,
    searchURL: String(json.searchURL || ""),
    searchList: String(json.searchList || ""),
    searchName: String(json.searchName || ""),
    searchResult: String(json.searchResult || ""),
    chapterRoads: String(json.chapterRoads || ""),
    chapterResult: String(json.chapterResult || ""),
    searchApiConfig: normalizeSearchApi(json.searchApiConfig),
    chapterApiConfig: normalizeChapterApi(json.chapterApiConfig),
    antiCrawlerConfig: normalizeAntiCrawler(json.antiCrawlerConfig),
  };

  if (rule.searchMode === "api") {
    if (!rule.searchApiConfig.request.url) throw new Error("API 搜索地址为空");
  } else if (!rule.searchURL || !rule.searchList || !rule.searchName || !rule.searchResult) {
    throw new Error("XPath 搜索规则不完整");
  }

  if (rule.chapterMode === "api") {
    if (!rule.chapterApiConfig.request.url) throw new Error("API 选集地址为空");
  } else if (!rule.chapterRoads || !rule.chapterResult) {
    throw new Error("XPath 选集规则不完整");
  }

  return rule;
}

export async function searchRule(rule, keyword, request) {
  const query = String(keyword || "").trim();
  if (!query) return [];
  const raw =
    rule.searchMode === "api"
      ? await request(prepareApiRequest(rule.searchApiConfig.request, { keyword: query }, rule))
      : await request(prepareXPathSearch(rule, query));
  assertNoCaptcha(rule, raw);
  const items =
    rule.searchMode === "api"
      ? parseApiSearch(raw, rule.searchApiConfig)
      : parseXPathSearch(raw, rule);
  return items.map((item) => ({
    id: rule.searchMode === "api" ? item.source : normalizeUrl(rule.baseUrl, item.source),
    name: item.name,
    pic: "",
    url: normalizeUrl(rule.baseUrl, item.source) || item.source,
  }));
}

export async function detailRule(rule, sourceKey, request) {
  const source = String(sourceKey || "").trim();
  if (!source) throw new Error("缺少详情地址");
  const raw =
    rule.chapterMode === "api"
      ? await request(prepareApiRequest(rule.chapterApiConfig.request, { source }, rule))
      : await request(prepareChapterRequest(rule, source));
  const roads =
    rule.chapterMode === "api"
      ? parseApiChapters(raw, rule.chapterApiConfig, { source, baseUrl: rule.baseUrl })
      : parseXPathChapters(raw, rule);
  if (!roads.length) throw new Error("没有解析到播放线路");

  const lines = roads.map((road, roadIndex) => ({
    sid: roadIndex + 1,
    name: road.name,
    episodes: road.episodes.map((episode, episodeIndex) => ({
      sid: roadIndex + 1,
      nid: episodeIndex + 1,
      label: episode.name,
      pageUrl: episode.url,
      watchUrl: episode.url,
      playApi: `/api/source-play?source=${encodeURIComponent(kazumiSourceId(rule.name))}&id=${encodeURIComponent(source)}&watch=${encodeURIComponent(episode.url)}`,
    })),
  }));

  return {
    source: kazumiSourceId(rule.name),
    name: rule.name,
    id: source,
    detailUrl: /^https?:\/\//i.test(source) ? source : normalizeUrl(rule.baseUrl, source),
    kind: "online",
    lines,
  };
}

export function rulePlayPageUrl(rule, watchUrl) {
  return normalizeUrl(rule.baseUrl, watchUrl);
}

export function rulePlayReferer(rule, pageUrl) {
  return playbackHeaders(rule, pageUrl).Referer;
}

export async function resolveRulePlay(rule, watchUrl, request) {
  const pageUrl = normalizeUrl(rule.baseUrl, watchUrl);
  const headers = playbackHeaders(rule, pageUrl);
  if (!pageUrl) throw new Error("缺少播放页地址");
  if (looksLikeMedia(pageUrl)) return { mediaUrl: pageUrl, pageUrl, headers };

  const html = await request(prepareDocumentRequest(pageUrl, rule));
  const mediaUrl = await findPlayable(html, pageUrl, rule, request);
  if (!mediaUrl) {
    throw new Error("这条规则没有给出可播放的直链，请换线路或换片源");
  }
  return { mediaUrl, pageUrl, headers };
}

export function queryXPath(root, expression) {
  const steps = parseXPath(expression);
  let nodes = [root];
  for (const step of steps) {
    nodes = unique(matchStep(nodes, step));
  }
  return nodes;
}

export function readJsonPath(document, expression) {
  const expr = String(expression || "").trim();
  if (!expr.startsWith("$")) throw new Error(`JSONPath 必须以 $ 开头: ${expression}`);
  let current = [document];
  for (const token of tokenizeJsonPath(expr)) {
    const next = [];
    for (const value of current) {
      if (token.kind === "prop") {
        if (value && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, token.name)) {
          next.push(value[token.name]);
        }
      } else if (token.kind === "wildcard") {
        if (Array.isArray(value)) next.push(...value);
        else if (value && typeof value === "object") next.push(...Object.values(value));
      } else if (token.kind === "index" && Array.isArray(value) && value[token.index] !== undefined) {
        next.push(value[token.index]);
      }
    }
    current = next;
  }
  return current;
}

function normalizeSearchApi(config) {
  const source = config && typeof config === "object" ? config : {};
  return {
    request: normalizeRequest(source.request),
    listPath: String(source.listPath || "$.data[*]"),
    namePath: String(source.namePath || "$.name"),
    sourcePath: String(source.sourcePath || "$.url"),
  };
}

function normalizeChapterApi(config) {
  const source = config && typeof config === "object" ? config : {};
  const page = source.episodePage && typeof source.episodePage === "object" ? source.episodePage : null;
  return {
    request: normalizeRequest(source.request),
    format: source.format === "delimited" ? "delimited" : "nested",
    roadsPath: String(source.roadsPath || ""),
    roadNamePath: String(source.roadNamePath || ""),
    episodesPath: String(source.episodesPath || "$.episodes[*]"),
    episodeNamePath: String(source.episodeNamePath || "$.name"),
    episodeUrlPath: String(source.episodeUrlPath || "$.url"),
    roadNamesPath: String(source.roadNamesPath || ""),
    roadEpisodesPath: String(source.roadEpisodesPath || ""),
    roadSeparator: String(source.roadSeparator || "$$$"),
    episodeSeparator: String(source.episodeSeparator || "#"),
    fieldSeparator: String(source.fieldSeparator || "$"),
    variables: source.variables && typeof source.variables === "object" ? { ...source.variables } : {},
    episodePage: page
      ? {
          url: String(page.url || ""),
          query: page.query && typeof page.query === "object" ? { ...page.query } : {},
        }
      : null,
  };
}

function normalizeRequest(config) {
  const source = config && typeof config === "object" ? config : {};
  return {
    method: String(source.method || "GET").toUpperCase() === "POST" ? "POST" : "GET",
    url: String(source.url || ""),
    headers: source.headers && typeof source.headers === "object" ? { ...source.headers } : {},
    query: source.query && typeof source.query === "object" ? { ...source.query } : {},
    bodyType: source.bodyType === "json" || source.bodyType === "form" ? source.bodyType : "none",
    body: source.body,
  };
}

function normalizeAntiCrawler(config) {
  const source = config && typeof config === "object" ? config : {};
  return {
    enabled: Boolean(source.enabled),
    captchaDetectValue: String(source.captchaDetectValue || ""),
  };
}

function prepareXPathSearch(rule, keyword) {
  const queryUrl = rule.searchURL.replaceAll("@keyword", encodeURIComponent(keyword));
  const url = new URL(queryUrl);
  if (!rule.usePost) return prepareDocumentRequest(url.href, rule);
  const body = new URLSearchParams(url.searchParams);
  url.search = "";
  return {
    url: url.href,
    method: "POST",
    headers: {
      ...documentHeaders(rule, rule.baseUrl || url.href),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  };
}

function prepareChapterRequest(rule, source) {
  return prepareDocumentRequest(normalizeUrl(rule.baseUrl, source), rule);
}

function prepareDocumentRequest(url, rule) {
  return {
    url,
    method: "GET",
    headers: documentHeaders(rule, url),
  };
}

function prepareApiRequest(config, variables, rule) {
  const method = config.method === "POST" ? "POST" : "GET";
  const url = appendQuery(
    renderTemplate(config.url, variables, true),
    renderObject(config.query, variables)
  );
  const headers = {
    Accept: "application/json, text/plain, */*",
    ...renderObject(config.headers, variables),
    ...documentHeaders(rule, url),
  };
  let body;
  if (method === "POST" && config.bodyType === "json") {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
    body = JSON.stringify(renderValue(config.body ?? {}, variables));
  } else if (method === "POST" && config.bodyType === "form") {
    headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded";
    const form = renderObject(config.body && typeof config.body === "object" ? config.body : {}, variables);
    body = new URLSearchParams(Object.entries(form).map(([key, value]) => [key, String(value ?? "")])).toString();
  }
  return { url, method, headers, body };
}

function parseXPathSearch(raw, rule) {
  const root = parseHtmlImpl(raw);
  const items = [];
  for (const node of queryXPath(root, rule.searchList)) {
    const name = textOf(queryXPath(node, rule.searchName)[0]).trim();
    const source = attrOf(queryXPath(node, rule.searchResult)[0], "href");
    if (name && source) items.push({ name, source });
  }
  return items;
}

function parseXPathChapters(raw, rule) {
  const root = parseHtmlImpl(raw);
  const roads = [];
  for (const roadNode of queryXPath(root, rule.chapterRoads)) {
    const episodes = [];
    queryXPath(roadNode, rule.chapterResult).forEach((node, index) => {
      const source = attrOf(node, "href");
      if (!source) return;
      const name = textOf(node).replace(/\s+/g, "") || `第${index + 1}集`;
      episodes.push({ name, url: normalizeUrl(rule.baseUrl, source) });
    });
    if (!episodes.length) continue;
    roads.push({ name: `播放线路${roads.length + 1}`, episodes });
  }
  return roads;
}

function parseApiSearch(raw, config) {
  const document = decodeJson(raw);
  return readJsonPath(document, config.listPath).flatMap((node) => {
    const name = stringValue(readJsonPath(node, config.namePath)[0]);
    const source = stringValue(readJsonPath(node, config.sourcePath)[0]);
    return name && source ? [{ name, source }] : [];
  });
}

function parseApiChapters(raw, config, context) {
  const document = decodeJson(raw);
  const variables = { source: context.source };
  for (const [key, path] of Object.entries(config.variables || {})) {
    const value = readJsonPath(document, path)[0];
    if (value == null) throw new Error(`章节变量 ${key} 没有匹配到值`);
    variables[key] = value;
  }
  if (config.format === "delimited") return parseDelimitedChapters(document, config, variables, context.baseUrl);
  return parseNestedChapters(document, config, variables, context.baseUrl);
}

function parseNestedChapters(document, config, variables, baseUrl) {
  const roadNodes = config.roadsPath.trim()
    ? readJsonPath(document, config.roadsPath)
    : [document];
  const roads = [];
  roadNodes.forEach((roadNode, roadIndex) => {
    const roadName = config.roadNamePath.trim()
      ? stringValue(readJsonPath(roadNode, config.roadNamePath)[0])
      : "";
    const episodes = [];
    readJsonPath(roadNode, config.episodesPath).forEach((episodeNode, episodeIndex) => {
      const episodeName = stringValue(readJsonPath(episodeNode, config.episodeNamePath)[0]);
      const rawUrl = config.episodeUrlPath.trim()
        ? stringValue(readJsonPath(episodeNode, config.episodeUrlPath)[0])
        : "";
      const pageUrl = resolveEpisodeUrl(config, variables, {
        rawUrl,
        roadIndex,
        episodeIndex,
        baseUrl,
      });
      if (!pageUrl) return;
      episodes.push({
        name: episodeName || `第${episodeIndex + 1}集`,
        url: pageUrl,
      });
    });
    if (!episodes.length) return;
    roads.push({ name: roadName || `播放线路${roads.length + 1}`, episodes });
  });
  return roads;
}

function parseDelimitedChapters(document, config, variables, baseUrl) {
  const namesValue = stringValue(readJsonPath(document, config.roadNamesPath)[0]);
  const episodesValue = stringValue(readJsonPath(document, config.roadEpisodesPath)[0]);
  if (!episodesValue) return [];
  const roadNames = namesValue ? namesValue.split(config.roadSeparator) : [];
  const roads = [];
  episodesValue.split(config.roadSeparator).forEach((group, roadIndex) => {
    const episodes = [];
    group.split(config.episodeSeparator).forEach((entry, episodeIndex) => {
      const trimmed = entry.trim();
      if (!trimmed) return;
      const separatorAt = trimmed.indexOf(config.fieldSeparator);
      if (separatorAt < 0) return;
      const name = trimmed.slice(0, separatorAt).trim();
      const rawUrl = trimmed.slice(separatorAt + config.fieldSeparator.length).trim();
      const pageUrl = resolveEpisodeUrl(config, variables, {
        rawUrl,
        roadIndex,
        episodeIndex,
        baseUrl,
      });
      if (!pageUrl) return;
      episodes.push({ name: name || `第${episodeIndex + 1}集`, url: pageUrl });
    });
    if (!episodes.length) return;
    roads.push({
      name: (roadNames[roadIndex] || "").trim() || `播放线路${roads.length + 1}`,
      episodes,
    });
  });
  return roads;
}

function resolveEpisodeUrl(config, variables, { rawUrl, roadIndex, episodeIndex, baseUrl }) {
  if (!config.episodePage?.url) return normalizeUrl(baseUrl, rawUrl);
  const scope = {
    ...variables,
    episodeUrl: rawUrl,
    roadIndex,
    roadNumber: roadIndex + 1,
    episodeIndex,
    episodeNumber: episodeIndex + 1,
  };
  const rendered = renderTemplate(config.episodePage.url, scope, true);
  const url = new URL(rendered, baseUrl || undefined);
  for (const [key, value] of Object.entries(renderObject(config.episodePage.query, scope))) {
    url.searchParams.set(key, String(value ?? ""));
  }
  return url.href;
}

async function findPlayable(html, pageUrl, rule, request) {
  const decoded = String(html || "").replace(/\\\//g, "/");
  const playerUrl = extractPlayerUrl(decoded);
  if (looksLikeMedia(playerUrl)) return normalizeUrl(pageUrl, playerUrl);
  const scanned = findMediaUrl(decoded);
  if (scanned) return normalizeUrl(pageUrl, scanned);
  if (playerUrl && /^https?:\/\//i.test(playerUrl) && !/\.html?(\?|#|$)/i.test(playerUrl)) {
    const nextHtml = await request(prepareDocumentRequest(playerUrl, rule)).catch(() => "");
    const nested = findMediaUrl(String(nextHtml).replace(/\\\//g, "/")) || extractPlayerUrl(nextHtml);
    if (looksLikeMedia(nested)) return normalizeUrl(playerUrl, nested);
    if (looksLikeMedia(playerUrl) || /m3u8|mp4/i.test(playerUrl)) return playerUrl;
  }
  return "";
}

function extractPlayerUrl(html) {
  const match =
    String(html || "").match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i) ||
    String(html || "").match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!match) return "";
  try {
    const data = JSON.parse(match[1]);
    let url = String(data.url || "");
    const encrypt = Number(data.encrypt || 0);
    if (encrypt === 1 || encrypt === 2) url = decodeBase64Utf8(url);
    if (encrypt === 2) {
      try {
        url = decodeURIComponent(url);
      } catch {
        // keep the base64-decoded value
      }
    }
    return url.trim();
  } catch {
    return "";
  }
}

function findMediaUrl(html) {
  const matches = String(html || "").match(/https?:\/\/[^"'\\\s<>]+?\.(?:m3u8|mp4)(?:\?[^"'\\\s<>]*)?/gi) || [];
  return matches.find((url) => !/ad[sx]?|banner|logo|thumb/i.test(url)) || matches[0] || "";
}

function looksLikeMedia(url) {
  return /\.m3u8(\?|#|$)/i.test(url) || /\.mp4(\?|#|$)/i.test(url);
}

function assertNoCaptcha(rule, raw) {
  const marker = rule.antiCrawlerConfig?.captchaDetectValue;
  if (rule.antiCrawlerConfig?.enabled && marker && String(raw || "").includes(marker)) {
    throw new Error("该规则触发了站点验证，当前无法继续");
  }
}

function documentHeaders(rule, url) {
  let referer = rule.referer || rule.baseUrl;
  if (!referer) {
    try {
      referer = `${new URL(url).origin}/`;
    } catch {
      referer = "";
    }
  }
  return {
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "User-Agent": rule.userAgent || DEFAULT_UA,
    ...(referer ? { Referer: referer } : {}),
  };
}

function playbackHeaders(rule, pageUrl) {
  let referer = rule.referer;
  if (!referer) {
    try {
      referer = `${new URL(pageUrl).origin}/`;
    } catch {
      referer = rule.baseUrl;
    }
  }
  return {
    Referer: referer,
    "User-Agent": rule.userAgent || DEFAULT_UA,
  };
}

function renderObject(input, variables) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    output[renderTemplate(key, variables, false)] = renderValue(value, variables);
  }
  return output;
}

function renderValue(value, variables) {
  if (typeof value === "string") {
    const exact = value.match(/^@([A-Za-z_][A-Za-z0-9_]*)$/);
    if (exact) {
      if (!Object.prototype.hasOwnProperty.call(variables, exact[1])) {
        throw new Error(`缺少模板变量 @${exact[1]}`);
      }
      return variables[exact[1]];
    }
    return renderTemplate(value, variables, false);
  }
  if (Array.isArray(value)) return value.map((item) => renderValue(item, variables));
  if (value && typeof value === "object") return renderObject(value, variables);
  return value;
}

function renderTemplate(template, variables, encode) {
  return String(template).replace(/(?<![A-Za-z0-9_])@([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(`缺少模板变量 @${name}`);
    }
    const value = variables[name] == null ? "" : String(variables[name]);
    return encode ? encodeURIComponent(value) : value;
  });
}

function appendQuery(url, query) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(query || {})) {
    if (value == null) continue;
    target.searchParams.set(key, String(value));
  }
  return target.href;
}

function decodeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("接口返回的不是 JSON");
  }
}

function stringValue(value) {
  if (value == null) return "";
  return typeof value === "string" ? value.trim() : String(value);
}

function normalizeUrl(baseUrl, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  try {
    return new URL(raw, baseUrl || undefined).href;
  } catch {
    return raw;
  }
}

function tokenizeJsonPath(expression) {
  const tokens = [];
  let index = 1;
  while (index < expression.length) {
    const char = expression[index];
    if (char === ".") {
      index += 1;
      const start = index;
      while (index < expression.length && /[A-Za-z0-9_$-]/.test(expression[index])) index += 1;
      if (index === start) throw new Error(`不支持的 JSONPath: ${expression}`);
      tokens.push({ kind: "prop", name: expression.slice(start, index) });
      continue;
    }
    if (char === "[") {
      const end = findBracket(expression, index);
      const content = expression.slice(index + 1, end).trim();
      index = end + 1;
      if (content === "*") {
        tokens.push({ kind: "wildcard" });
      } else if (/^\d+$/.test(content)) {
        tokens.push({ kind: "index", index: Number(content) });
      } else if (
        (content.startsWith("'") && content.endsWith("'")) ||
        (content.startsWith('"') && content.endsWith('"'))
      ) {
        tokens.push({ kind: "prop", name: content.slice(1, -1) });
      } else {
        throw new Error(`不支持的 JSONPath 片段: [${content}]`);
      }
      continue;
    }
    throw new Error(`不支持的 JSONPath: ${expression}`);
  }
  return tokens;
}

function parseXPath(expression) {
  const expr = String(expression || "").trim();
  if (!expr.startsWith("/")) throw new Error(`XPath 必须以 / 开头: ${expression}`);
  const steps = [];
  let index = 0;
  while (index < expr.length) {
    if (expr[index] !== "/") throw new Error(`XPath 无效: ${expression}`);
    const deep = expr[index + 1] === "/";
    index += deep ? 2 : 1;
    if (index >= expr.length) break;
    const start = index;
    while (index < expr.length && expr[index] !== "/" && expr[index] !== "[") index += 1;
    const tag = expr.slice(start, index).toLowerCase();
    if (!tag) throw new Error(`XPath 无效: ${expression}`);
    const predicates = [];
    while (expr[index] === "[") {
      const end = findBracket(expr, index);
      predicates.push(parsePredicate(expr.slice(index + 1, end)));
      index = end + 1;
    }
    steps.push({ deep, tag, predicates });
  }
  if (!steps.length) throw new Error(`XPath 无效: ${expression}`);
  return steps;
}

function parsePredicate(body) {
  const text = body.trim();
  if (/^\d+$/.test(text)) return { kind: "index", index: Number(text) };
  const contains = text.match(/^contains\(\s*@([\w:-]+)\s*,\s*(['"])([\s\S]*)\2\s*\)$/i);
  if (contains) return { kind: "contains", name: contains[1], value: contains[3] };
  const attr = text.match(/^@([\w:-]+)(?:\s*=\s*(['"])([\s\S]*)\2)?$/);
  if (attr) {
    return attr[2]
      ? { kind: "attr", name: attr[1], value: attr[3] }
      : { kind: "attrExists", name: attr[1] };
  }
  throw new Error(`不支持的 XPath 条件: [${text}]`);
}

function findBracket(expr, start) {
  let quote = "";
  for (let index = start + 1; index < expr.length; index += 1) {
    const char = expr[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "]") return index;
  }
  throw new Error(`XPath 缺少 ]: ${expr}`);
}

function matchStep(nodes, step) {
  const matched = [];
  for (const context of nodes) {
    const parents = step.deep ? [context, ...descendants(context)] : [context];
    for (const parent of parents) {
      let list = (parent.children || []).filter((node) => step.tag === "*" || node.name === step.tag);
      for (const predicate of step.predicates) list = applyPredicate(list, predicate);
      matched.push(...list);
    }
  }
  return matched;
}

function applyPredicate(nodes, predicate) {
  if (predicate.kind === "index") return nodes[predicate.index - 1] ? [nodes[predicate.index - 1]] : [];
  if (predicate.kind === "attr") {
    return nodes.filter((node) => String(node.attrs?.[predicate.name] ?? "") === predicate.value);
  }
  if (predicate.kind === "contains") {
    return nodes.filter((node) => String(node.attrs?.[predicate.name] ?? "").includes(predicate.value));
  }
  if (predicate.kind === "attrExists") {
    return nodes.filter((node) => node.attrs && predicate.name in node.attrs);
  }
  return nodes;
}

function descendants(node) {
  const output = [];
  const stack = [...(node.children || [])];
  while (stack.length) {
    const current = stack.shift();
    output.push(current);
    if (current.children?.length) stack.unshift(...current.children);
  }
  return output;
}

function unique(nodes) {
  const seen = new Set();
  return nodes.filter((node) => {
    if (seen.has(node)) return false;
    seen.add(node);
    return true;
  });
}

function textOf(node) {
  return String(node?.text || "");
}

function attrOf(node, name) {
  return String(node?.attrs?.[name] || node?.attrs?.[name.toLowerCase()] || "").trim();
}

function parseHtmlWithDom(html) {
  if (typeof DOMParser === "undefined") {
    throw new Error("当前环境不能解析 HTML 规则");
  }
  const document = new DOMParser().parseFromString(String(html || ""), "text/html");
  return fromDom(document.documentElement) || { name: "#document", attrs: {}, children: [], text: "" };
}

function fromDom(element) {
  if (!element || element.nodeType !== 1) return null;
  const name = element.tagName.toLowerCase();
  if (name === "script" || name === "style") return null;
  const attrs = {};
  for (const attr of [...element.attributes]) attrs[attr.name] = attr.value;
  const children = [];
  for (const child of [...element.childNodes]) {
    if (child.nodeType !== 1) continue;
    const next = fromDom(child);
    if (next) children.push(next);
  }
  return { name, attrs, children, text: domText(element) };
}

function domText(element) {
  let output = "";
  for (const child of [...element.childNodes]) {
    if (child.nodeType === 3) output += child.nodeValue || "";
    else if (child.nodeType === 1 && !/^(script|style)$/i.test(child.tagName)) output += domText(child);
  }
  return output.replace(/\s+/g, " ").trim();
}

function decodeBase64Utf8(value) {
  if (typeof Buffer !== "undefined") return Buffer.from(value, "base64").toString("utf8");
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
