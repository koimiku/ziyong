import { load } from "cheerio";

export function parseHtmlWithCheerio(html) {
  const $ = load(String(html || ""));
  const root = $.root().get(0);
  const children = [];
  for (const child of root?.children || []) {
    const node = fromCheerio(child);
    if (node) children.push(node);
  }
  return { name: "#document", attrs: {}, children, text: "" };
}

function fromCheerio(node) {
  if (!node || node.type !== "tag") return null;
  const name = String(node.name || "").toLowerCase();
  if (name === "script" || name === "style") return null;
  const children = [];
  for (const child of node.children || []) {
    const next = fromCheerio(child);
    if (next) children.push(next);
  }
  return {
    name,
    attrs: { ...(node.attribs || {}) },
    children,
    text: textOf(node),
  };
}

function textOf(node) {
  if (!node) return "";
  if (node.type === "text") return node.data || "";
  if (node.type === "tag" && (node.name === "script" || node.name === "style")) return "";
  return (node.children || [])
    .map(textOf)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
