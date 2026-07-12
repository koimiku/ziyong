import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "android-www");

const FILES = [
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "sw.js",
];

const DIRS = ["client", "icons"];

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const from = join(src, entry);
    const to = join(dest, entry);
    if (statSync(from).isDirectory()) copyDir(from, to);
    else cpSync(from, to);
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const file of FILES) {
  const from = join(ROOT, file);
  if (existsSync(from)) cpSync(from, join(OUT, file));
}

for (const dir of DIRS) {
  const from = join(ROOT, dir);
  if (existsSync(from)) copyDir(from, join(OUT, dir));
}

writeFileSync(
  join(OUT, "native.json"),
  JSON.stringify(
    {
      mode: "android-standalone",
      builtAt: new Date().toISOString(),
      version: "1.3.0",
    },
    null,
    2
  )
);

console.log(`[android-www] ready at ${OUT}`);
