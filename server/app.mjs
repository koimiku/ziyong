import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { createServer } from "node:http";
import { defaultPort, staticTypes } from "./config.mjs";
import { handleMediaProxy } from "./proxy.mjs";
import {
  handleMikanStreamRoute,
  handleSourceDetail,
  handleSourceHealth,
  handleSourcePlay,
  handleSourceSearch,
  handleSourcesHealth,
  handleTokuzillaLatest,
} from "./handlers.mjs";
import { handleBangumiCalendar, warmupBangumiCalendar } from "./bangumi.mjs";
import {
  handleMiruInstall,
  handleMiruInstalled,
  handleMiruRepo,
  handleMiruSources,
  handleMiruUninstall,
} from "./miru/handlers.mjs";
import { handleServerInfo, handleServerQr, setServerInfo } from "./info.mjs";
import { ensureMiruReady, setMiruRoot } from "./miru/repo.mjs";
import { getServerUrls } from "./network.mjs";
import {
  handleWatchHistoryGet,
  handleWatchHistoryPut,
  setWatchHistoryRoot,
} from "./watch-history.mjs";

let root = resolve(process.env.ANIME_ROOT || process.env.FANXUN_ROOT || process.cwd());

export function setAppRoot(nextRoot) {
  root = resolve(nextRoot);
  setMiruRoot(root);
  setWatchHistoryRoot(root);
}

export function startServer({ port = defaultPort, host = "127.0.0.1" } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url, "http://localhost");

      if (url.pathname === "/api/source-search") {
        await handleSourceSearch(url, response);
        return;
      }

      if (url.pathname === "/api/source-detail") {
        await handleSourceDetail(url, response);
        return;
      }

      if (url.pathname === "/api/source-play") {
        await handleSourcePlay(url, response);
        return;
      }

      if (url.pathname === "/api/source-health") {
        await handleSourceHealth(url, response);
        return;
      }

      if (url.pathname === "/api/sources-health") {
        await handleSourcesHealth(url, response);
        return;
      }

      if (url.pathname === "/api/tokuzilla/latest") {
        await handleTokuzillaLatest(url, response);
        return;
      }

      if (url.pathname === "/api/bangumi/calendar") {
        await handleBangumiCalendar(url, response);
        return;
      }

      if (url.pathname === "/api/media-proxy") {
        await handleMediaProxy(url, request, response);
        return;
      }

      if (url.pathname === "/api/mikan-stream") {
        await handleMikanStreamRoute(url, request, response);
        return;
      }

      if (url.pathname === "/api/miru/repo") {
        await handleMiruRepo(url, response);
        return;
      }

      if (url.pathname === "/api/miru/installed") {
        await handleMiruInstalled(url, response);
        return;
      }

      if (url.pathname === "/api/miru/sources") {
        await handleMiruSources(url, response);
        return;
      }

      if (url.pathname === "/api/miru/install") {
        await handleMiruInstall(url, response);
        return;
      }

      if (url.pathname === "/api/miru/uninstall") {
        await handleMiruUninstall(url, response);
        return;
      }

      if (url.pathname === "/api/server-info") {
        await handleServerInfo(url, response);
        return;
      }

      if (url.pathname === "/api/server-qr") {
        await handleServerQr(url, response);
        return;
      }

      if (url.pathname === "/api/watch-history") {
        if (request.method === "PUT" || request.method === "POST") {
          await handleWatchHistoryPut(request, response);
        } else {
          await handleWatchHistoryGet(url, response);
        }
        return;
      }

      const requestedPath = decodeURIComponent(url.pathname);
      const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
      let filePath = resolve(join(root, safePath));

      if (!filePath.startsWith(root)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = join(filePath, "index.html");
      }

      if (!existsSync(filePath)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const ext = extname(filePath);
      const cacheControl =
        ext === ".html" || ext === ".js" || ext === ".mjs" || ext === ".css"
          ? "no-store"
          : "public, max-age=3600";

      response.writeHead(200, {
        "Content-Type": staticTypes[ext] || "application/octet-stream",
        "Cache-Control": cacheControl,
      });
      createReadStream(filePath).pipe(response);
    });

    const tryListen = (candidatePort, attemptsLeft) => {
      const onError = (error) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
          tryListen(candidatePort + 1, attemptsLeft - 1);
          return;
        }
        rejectPromise(error);
      };

      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        const resolvedPort =
          typeof address === "object" && address ? address.port : candidatePort;
        setServerInfo({ port: resolvedPort, host });
        const urls = getServerUrls(resolvedPort, host);
        console.log(`Preview running at ${urls[0]}`);
        if (host === "0.0.0.0" && urls.length > 1) {
          console.log("Phone access:");
          urls.slice(1).forEach((entry) => console.log(`  ${entry}`));
        }
        warmupBangumiCalendar();
        resolvePromise({ server, port: resolvedPort, url: urls[0], urls, host });
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(candidatePort, host);
    };

    setMiruRoot(root);
    setWatchHistoryRoot(root);
    ensureMiruReady(root)
      .then(() => tryListen(port, 20))
      .catch((error) => {
        console.warn("[miru] init failed, starting without extensions", error);
        tryListen(port, 20);
      });
  });
}
