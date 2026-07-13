import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (path.endsWith(".js")) acc.push(path);
  }
  return acc;
}

const bare = [];
for (const file of walk("android-www")) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = match[1];
    if (!spec.startsWith(".") && !spec.startsWith("/")) {
      bare.push(`${file}: from '${spec}'`);
    }
  }
  for (const match of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = match[1];
    if (!spec.startsWith(".") && !spec.startsWith("/")) {
      bare.push(`${file}: import('${spec}')`);
    }
  }
}

console.log(bare.length ? bare.join("\n") : "no bare imports found");
