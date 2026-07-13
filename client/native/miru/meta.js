export function parseExtensionMeta(script) {
  const block = String(script || "").match(
    /\/\/\s*==MiruExtension==([\s\S]*?)\/\/\s*==\/MiruExtension==/
  );
  if (!block) {
    throw new Error("Not a Miru extension (missing metadata block)");
  }

  const meta = {};
  for (const line of block[1].split(/\r?\n/)) {
    const match = line.match(/\/\/\s*@(\w+)\s+(.+?)\s*$/);
    if (!match) continue;
    meta[match[1]] = match[2].trim();
  }

  if (!meta.package || !meta.name || !meta.type) {
    throw new Error("Invalid Miru extension metadata");
  }

  return {
    name: meta.name,
    version: meta.version || "",
    author: meta.author || "",
    lang: meta.lang || "",
    license: meta.license || "",
    icon: meta.icon || "",
    package: meta.package,
    type: meta.type,
    webSite: meta.webSite || meta.website || "",
    nsfw: String(meta.nsfw || "false").toLowerCase() === "true",
    description: meta.description || "",
  };
}

export function transformExtensionScript(script) {
  let code = String(script || "").replace(
    /\/\/\s*==MiruExtension==[\s\S]*?\/\/\s*==\/MiruExtension==/,
    ""
  );

  if (!/export\s+default\s+class(?:\s+[A-Za-z0-9_$]+)?\s+extends\s+Extension/.test(code)) {
    throw new Error("Extension must export default class extends Extension");
  }

  code = code.replace(
    /export\s+default\s+class(?:\s+[A-Za-z0-9_$]+)?\s+extends\s+Extension/,
    "class __MiruExtensionClass extends Extension"
  );

  code += "\n;globalThis.__MiruExtensionClass = __MiruExtensionClass;\n";
  return code;
}
