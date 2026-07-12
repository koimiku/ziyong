import * as cheerio from "cheerio";

export function createElementClass() {
  return class Element {
    constructor(content, selector = "") {
      this.content = content;
      this.selector = selector || "";
    }

    async querySelector(selector) {
      return new Element(await this.excute(), selector);
    }

    async excute(fun) {
      return querySelectorValue(this.content, this.selector, fun);
    }

    async removeSelector(selector) {
      this.content = removeSelector(await this.outerHTML, selector);
      return this;
    }

    async getAttributeText(attr) {
      return getAttributeText(await this.outerHTML, this.selector, attr);
    }

    get text() {
      return this.excute("text");
    }

    get outerHTML() {
      return this.excute("outerHTML");
    }

    get innerHTML() {
      return this.excute("innerHTML");
    }
  };
}

export function createXPathClass() {
  return class XPathNode {
    constructor(content, selector) {
      this.content = content;
      this.selector = selector;
    }

    async excute(fun) {
      return queryXPathValue(this.content, this.selector, fun);
    }

    get attr() {
      return this.excute("attr");
    }

    get attrs() {
      return this.excute("attrs");
    }

    get text() {
      return this.excute("text");
    }

    get allHTML() {
      return this.excute("allHTML");
    }

    get outerHTML() {
      return this.excute("outerHTML");
    }
  };
}

export function querySelectorValue(content, selector, fun) {
  const $ = cheerio.load(content || "", { xml: false });
  const node = selector ? $(selector).first() : $.root();
  if (!node || !node.length) return "";

  switch (fun) {
    case "text":
      return node.text() || "";
    case "innerHTML":
      return node.html() || "";
    case "outerHTML":
    default:
      return $.html(node) || "";
  }
}

export function querySelectorAllHtml(content, selector) {
  const $ = cheerio.load(content || "", { xml: false });
  return $(selector)
    .toArray()
    .map((el) => $.html(el));
}

export function removeSelector(content, selector) {
  const $ = cheerio.load(content || "", { xml: false });
  $(selector).remove();
  return $.root().html() || $.html() || "";
}

export function getAttributeText(content, selector, attr) {
  const $ = cheerio.load(content || "", { xml: false });
  const node = selector ? $(selector).first() : $.root();
  if (!node || !node.length) return "";
  return node.attr(attr) || "";
}

export function queryXPathValue(content, selector, fun) {
  // Best-effort: treat simple paths like //div[@class='x'] as CSS when possible.
  const cssGuess = xpathToCssGuess(selector);
  if (cssGuess) {
    const $ = cheerio.load(content || "", { xml: false });
    const nodes = $(cssGuess);
    switch (fun) {
      case "attr":
        return nodes.first().attr()
          ? Object.values(nodes.first().attr())[0] || ""
          : "";
      case "attrs":
        return JSON.stringify(
          nodes
            .toArray()
            .map((el) => $(el).attr() || {})
            .flatMap((attrs) => Object.values(attrs))
        );
      case "text":
        return nodes.first().text() || "";
      case "allHTML":
        return nodes
          .toArray()
          .map((el) => $.html(el))
          .toString();
      case "outerHTML":
        return $.html(nodes.first()) || "";
      default:
        return nodes.first().text() || "";
    }
  }

  throw new Error(`Unsupported XPath in Miru runtime: ${selector}`);
}

function xpathToCssGuess(selector) {
  const value = String(selector || "").trim();
  if (!value) return "";

  // //div[@class='foo'] -> div.foo
  const classMatch = value.match(/^\/\/([a-z0-9]+)\[@class=['"]([^'"]+)['"]\]$/i);
  if (classMatch) {
    return `${classMatch[1]}.${classMatch[2].trim().split(/\s+/).join(".")}`;
  }

  // //a[@href] / //div -> a / div
  const tagMatch = value.match(/^\/\/([a-z0-9]+)$/i);
  if (tagMatch) return tagMatch[1];

  return "";
}
