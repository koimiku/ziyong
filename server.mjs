import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setAppRoot, startServer } from "./server/app.mjs";

export { setAppRoot, startServer };

const isDirectRun =
  process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isDirectRun) {
  const host = process.env.HOST || process.env.ANIME_HOST || "0.0.0.0";
  startServer({ host }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
