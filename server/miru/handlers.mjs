import { writeJson } from "../utils.mjs";
import { DEFAULT_MIRU_REPO } from "./config.mjs";
import {
  fetchRepoIndex,
  getInstalledSources,
  installExtension,
  listInstalledMeta,
  uninstallExtension,
} from "./repo.mjs";

export async function handleMiruRepo(url, response) {
  try {
    const repoUrl = String(url.searchParams.get("repo") || DEFAULT_MIRU_REPO);
    const index = await fetchRepoIndex(repoUrl);
    const installed = new Set(listInstalledMeta().map((item) => item.package));
    const list = index
      .filter((item) => item.type === "bangumi")
      .filter((item) => String(item.nsfw || "false").toLowerCase() !== "true")
      .map((item) => ({
        ...item,
        installed: installed.has(item.package),
      }));
    writeJson(response, 200, { repo: repoUrl, list });
  } catch (error) {
    writeJson(response, 502, { error: String(error?.message || error) });
  }
}

export async function handleMiruInstalled(_url, response) {
  writeJson(response, 200, {
    list: listInstalledMeta(),
    sources: getInstalledSources(),
  });
}

export async function handleMiruSources(_url, response) {
  writeJson(response, 200, { list: getInstalledSources() });
}

export async function handleMiruInstall(url, response) {
  const packageName = String(url.searchParams.get("package") || "").trim();
  const repoUrl = String(url.searchParams.get("repo") || DEFAULT_MIRU_REPO);
  if (!packageName) {
    writeJson(response, 400, { error: "Missing package" });
    return;
  }

  try {
    const meta = await installExtension(packageName, repoUrl);
    writeJson(response, 200, { ok: true, meta, sources: getInstalledSources() });
  } catch (error) {
    writeJson(response, 502, { error: String(error?.message || error) });
  }
}

export async function handleMiruUninstall(url, response) {
  const packageName = String(url.searchParams.get("package") || "").trim();
  if (!packageName) {
    writeJson(response, 400, { error: "Missing package" });
    return;
  }

  try {
    uninstallExtension(packageName);
    writeJson(response, 200, { ok: true, sources: getInstalledSources() });
  } catch (error) {
    writeJson(response, 502, { error: String(error?.message || error) });
  }
}
