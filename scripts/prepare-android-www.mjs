import { readFileSync, cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "android-www");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const APP_VERSION = String(PKG.version || "0.0.0");

const FILES = [
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "sw.js",
  "update.json",
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

writeFileSync(
  join(ROOT, "update.json"),
  `${JSON.stringify(
    {
      version: APP_VERSION,
      name: `v${APP_VERSION}`,
      notes: `anime Android ${APP_VERSION}`,
      htmlUrl: `https://github.com/koimiku/ziyong/releases/tag/v${APP_VERSION}`,
      apkUrl: `https://github.com/koimiku/ziyong/releases/download/v${APP_VERSION}/app-release.apk`,
    },
    null,
    2
  )}\n`
);

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
      version: APP_VERSION,
      githubRepo: "koimiku/ziyong",
    },
    null,
    2
  )
);

console.log(`[android-www] ready at ${OUT} (v${APP_VERSION})`);
