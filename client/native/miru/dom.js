function parseDocument(content) {
  const html = String(content || "");
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

function pickNode(doc, selector) {
  if (!selector) return doc.documentElement || doc.body;
  return doc.querySelector(selector);
}

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
  const doc = parseDocument(content);
  const node = pickNode(doc, selector);
  if (!node) return "";

  switch (fun) {
    case "text":
      return node.textContent || "";
    case "innerHTML":
      return node.innerHTML || "";
    case "outerHTML":
    default:
      return node.outerHTML || node.innerHTML || "";
  }
}

export function querySelectorAllHtml(content, selector) {
  const doc = parseDocument(content);
  return [...doc.querySelectorAll(selector || "*")].map(
    (el) => el.outerHTML || ""
  );
}

export function removeSelector(content, selector) {
  const doc = parseDocument(content);
  doc.querySelectorAll(selector || "").forEach((node) => node.remove());
  return doc.body?.innerHTML || doc.documentElement?.outerHTML || "";
}

export function getAttributeText(content, selector, attr) {
  const doc = parseDocument(content);
  const node = pickNode(doc, selector);
  if (!node || !attr) return "";
  return node.getAttribute(attr) || "";
}

export function queryXPathValue(content, selector, fun) {
  const cssGuess = xpathToCssGuess(selector);
  if (cssGuess) {
    const doc = parseDocument(content);
    const nodes = [...doc.querySelectorAll(cssGuess)];
    const first = nodes[0];
    switch (fun) {
      case "attr": {
        if (!first?.attributes?.length) return "";
        return first.attributes[0].value || "";
      }
      case "attrs":
        return JSON.stringify(
          nodes.flatMap((el) =>
            [...el.attributes].map((attr) => attr.value)
          )
        );
      case "text":
        return first?.textContent || "";
      case "allHTML":
        return nodes.map((el) => el.outerHTML || "").toString();
      case "outerHTML":
        return first?.outerHTML || "";
      default:
        return first?.textContent || "";
    }
  }

  throw new Error(`Unsupported XPath in Miru runtime: ${selector}`);
}

function xpathToCssGuess(selector) {
  const value = String(selector || "").trim();
  if (!value) return "";

  const classMatch = value.match(/^\/\/([a-z0-9]+)\[@class=['"]([^'"]+)['"]\]$/i);
  if (classMatch) {
    return `${classMatch[1]}.${classMatch[2].trim().split(/\s+/).join(".")}`;
  }

  const tagMatch = value.match(/^\/\/([a-z0-9]+)$/i);
  if (tagMatch) return tagMatch[1];

  return "";
}
