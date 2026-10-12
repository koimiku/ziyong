import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detailRule,
  normalizeRule,
  queryXPath,
  readJsonPath,
  resolveRulePlay,
  searchRule,
  setHtmlParser,
} from "../client/kazumi/engine.js";
import { parseHtmlWithCheerio } from "../server/kazumi/html.mjs";

function element(name, attrs = {}, children = [], text = "") {
  return { name, attrs, children, text };
}

const xpathRule = normalizeRule({
  name: "demo",
  type: "anime",
  baseURL: "https://example.com/",
  searchURL: "https://example.com/s?wd=@keyword",
  searchList: "//div[@class='public-list-box search-box flex rel']",
  searchName: "//div[3]/div[1]/div[1]",
  searchResult: "//div[3]/div[2]/a[1]",
  chapterRoads: "//ul[@class='anthology-list-play size']",
  chapterResult: "//li/a",
});

const searchHtml = `
  <div class="public-list-box search-box flex rel">
    <div>cover</div>
    <div>meta</div>
    <div>
      <div><div>示例番</div></div>
      <div><a href="/vod/1.html">播放</a></div>
    </div>
  </div>
`;

const chapterHtml = `
  <ul class="anthology-list-play size">
    <li><a href="/play/1.html">第1集</a></li>
    <li><a href="/play/2.html">第2集</a></li>
  </ul>
`;

test("xpath position and class selectors follow each result card", () => {
  const title = element("div", {}, [], "示例番");
  const link = element("a", { href: "/vod/1.html" }, [], "播放");
  const card = element(
    "div",
    { class: "public-list-box search-box flex rel" },
    [
      element("div"),
      element("div"),
      element("div", {}, [element("div", {}, [title]), element("div", {}, [link])]),
    ]
  );
  const cards = queryXPath(element("#document", {}, [card]), xpathRule.searchList);
  assert.equal(cards.length, 1);
  assert.equal(queryXPath(cards[0], xpathRule.searchName)[0].text, "示例番");
  assert.equal(queryXPath(cards[0], xpathRule.searchResult)[0].attrs.href, "/vod/1.html");
});

test("html search and chapter rules resolve titles and episode urls", async () => {
  setHtmlParser(parseHtmlWithCheerio);
  const calls = [];
  const request = async (prepared) => {
    calls.push(prepared);
    return prepared.url.includes("/s?") ? searchHtml : chapterHtml;
  };

  const list = await searchRule(xpathRule, "示例", request);
  assert.equal(calls[0].url, "https://example.com/s?wd=%E7%A4%BA%E4%BE%8B");
  assert.deepEqual(list, [
    {
      id: "https://example.com/vod/1.html",
      name: "示例番",
      pic: "",
      url: "https://example.com/vod/1.html",
    },
  ]);

  const detail = await detailRule(xpathRule, list[0].id, request);
  assert.equal(detail.lines.length, 1);
  assert.equal(detail.lines[0].episodes[0].label, "第1集");
  assert.equal(detail.lines[0].episodes[0].pageUrl, "https://example.com/play/1.html");
  assert.equal(detail.lines[0].episodes[1].label, "第2集");
});

test("api rules fill keyword and source into the request", async () => {
  const rule = normalizeRule({
    name: "api-demo",
    type: "anime",
    baseURL: "https://example.com/",
    searchMode: "api",
    chapterMode: "api",
    searchApiConfig: {
      request: {
        method: "POST",
        url: "https://api.example.com/search",
        bodyType: "json",
        body: { q: "@keyword" },
      },
      listPath: "$[*]",
      namePath: "$.title",
      sourcePath: "$.id",
    },
    chapterApiConfig: {
      request: { method: "GET", url: "https://api.example.com/video/@source" },
      format: "nested",
      roadsPath: "$.roads[*]",
      roadNamePath: "$.name",
      episodesPath: "$.episodes[*]",
      episodeNamePath: "$.title",
      episodeUrlPath: "$.page",
      episodePage: { url: "https://example.com/play/@source/@episodeUrl", query: {} },
    },
  });

  const seen = [];
  const request = async (prepared) => {
    seen.push(prepared);
    if (prepared.method === "POST") return JSON.stringify([{ title: "示例番", id: "42" }]);
    return JSON.stringify({
      roads: [{ name: "线路A", episodes: [{ title: "第1集", page: "7" }] }],
    });
  };

  const list = await searchRule(rule, "示例", request);
  assert.equal(JSON.parse(seen[0].body).q, "示例");
  assert.equal(list[0].id, "42");

  const detail = await detailRule(rule, "42", request);
  assert.equal(seen[1].url, "https://api.example.com/video/42");
  assert.equal(detail.lines[0].name, "线路A");
  assert.equal(detail.lines[0].episodes[0].pageUrl, "https://example.com/play/42/7");
});

test("json path reads nested lists", () => {
  const rows = readJsonPath({ data: { records: [{ title: "A" }, { title: "B" }] } }, "$.data.records[*]");
  assert.equal(rows.length, 2);
  assert.equal(readJsonPath(rows[1], "$.title")[0], "B");
});

test("playback uses a direct address exposed by the play page", async () => {
  const found = await resolveRulePlay(
    xpathRule,
    "https://example.com/play/1.html",
    async () => 'player_aaaa={"url":"https://cdn.example.com/a.m3u8","encrypt":0}</script>'
  );
  assert.equal(found.mediaUrl, "https://cdn.example.com/a.m3u8");
  assert.equal(found.pageUrl, "https://example.com/play/1.html");
});
