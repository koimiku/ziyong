function episodeKey(episode) {
  if (episode?.nid != null && episode.nid !== "") return `nid:${episode.nid}`;
  return `label:${String(episode?.label || "").trim()}`;
}

export function buildEpisodeSourceMap(playlists) {
  const map = new Map();

  playlists.forEach((playlist, playlistIndex) => {
    (playlist.lines || []).forEach((line, lineIndex) => {
      (line.episodes || []).forEach((episode, episodeIndex) => {
        const key = episodeKey(episode);
        if (!map.has(key)) {
          map.set(key, {
            key,
            nid: episode.nid ?? null,
            label: episode.label,
            sources: [],
          });
        }
        map.get(key).sources.push({
          playlistIndex,
          lineIndex,
          episodeIndex,
          sourceId: playlist.sourceId,
          sourceName: playlist.sourceName,
          lineName: line.name,
          playApi: episode.playApi,
          pageUrl: episode.pageUrl,
          kind: playlist.kind || "online",
          matchScore: playlist.matchScore || 0,
        });
      });
    });
  });

  return [...map.values()]
    .map((entry) => ({
      ...entry,
      sources: entry.sources.sort(
        (a, b) =>
          sourceRank(a) - sourceRank(b) ||
          Number(b.matchScore || 0) - Number(a.matchScore || 0)
      ),
    }))
    .sort((a, b) => {
      const aNid = Number(a.nid);
      const bNid = Number(b.nid);
      if (Number.isFinite(aNid) && Number.isFinite(bNid) && aNid !== bNid) {
        return aNid - bNid;
      }
      return String(a.label).localeCompare(String(b.label), "zh-CN", { numeric: true });
    });
}

function sourceRank(source) {
  if (source.kind === "torrent") return 20;
  if (String(source.sourceId || "").startsWith("miru:")) return 10;
  if (source.sourceId === "xfdm") return 0;
  if (source.sourceId === "xgcartoon") return 1;
  if (source.sourceId === "omofun") return 2;
  if (source.sourceId === "gugu") return 3;
  return 5;
}

export function findEpisodeIndex(episodeSourceMap, resume) {
  if (!resume || !episodeSourceMap.length) return 0;
  const byNid = resume.episodeNid != null
    ? episodeSourceMap.findIndex((entry) => entry.nid === resume.episodeNid)
    : -1;
  if (byNid >= 0) return byNid;
  const byLabel = resume.episodeLabel
    ? episodeSourceMap.findIndex((entry) => entry.label === resume.episodeLabel)
    : -1;
  return byLabel >= 0 ? byLabel : 0;
}

export function findSourceIndex(episodeEntry, resume) {
  if (!episodeEntry?.sources?.length) return 0;
  if (!resume?.sourceId) return 0;
  const index = episodeEntry.sources.findIndex(
    (source) =>
      source.sourceId === resume.sourceId &&
      (resume.lineIndex == null || source.lineIndex === resume.lineIndex)
  );
  return index >= 0 ? index : 0;
}

export function renderEpisodeSourceChips(episodeEntry, activeSourceIndex) {
  if (!episodeEntry?.sources?.length) return "";
  return episodeEntry.sources
    .map(
      (source, index) => `
        <button
          class="episode-source-chip${index === activeSourceIndex ? " active" : ""}"
          type="button"
          data-source-index="${index}"
          title="${escapeAttr(`${source.sourceName} · ${source.lineName}`)}"
        >
          ${escapeHtml(source.sourceName.replace(/ · Miru$/, ""))}
        </button>
      `
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
