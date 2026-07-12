import { renderEpisodeSourceChips } from "./episode-sources.js";
import { recordWatchProgress } from "./watch-history.js";
import { escapeHtml } from "./utils.js";

const streamCache = new Map();

export function bindSourcePlayer(playlistState, episodeSourceMap, context = {}) {
  const video = document.querySelector("#sourcePlayer");
  const embed = document.querySelector("#sourceEmbed");
  const playerFrame = document.querySelector("#playerFrame");
  const playStartButton = document.querySelector("#playStartButton");
  const playStartHint = document.querySelector("#playStartHint");
  const episodeTabs = document.querySelector("#episodeTabs");
  const sourceChips = document.querySelector("#episodeSourceChips");
  const meta = document.querySelector("#sourcePlayerMeta");
  const status = document.querySelector("#sourcePlayerStatus");
  const openLink = document.querySelector("#sourceOpenLink");
  if (
    !video ||
    !embed ||
    !playerFrame ||
    !playStartButton ||
    !playStartHint ||
    !episodeTabs ||
    !sourceChips ||
    !meta ||
    !status ||
    !openLink
  ) {
    return null;
  }

  let episodes = episodeSourceMap;
  const resume = context.resume || null;
  const itemId = context.itemId || null;

  const state = {
    episodeIndex: Math.max(
      0,
      episodes.findIndex((entry) =>
        resume?.episodeNid != null
          ? entry.nid === resume.episodeNid
          : resume?.episodeLabel
            ? entry.label === resume.episodeLabel
            : false
      )
    ),
    sourceIndex: 0,
    requestId: 0,
    hls: null,
    started: false,
    resumePosition: Number(resume?.position || 0),
    progressTimer: null,
    progressCleanups: [],
  };

  if (state.episodeIndex < 0) state.episodeIndex = 0;
  state.sourceIndex = findInitialSourceIndex(currentEpisodeEntry(), resume);

  function playlists() {
    return playlistState.items;
  }

  function currentEpisodeEntry() {
    return episodes[state.episodeIndex] || episodes[0];
  }

  function currentSourceRef() {
    const entry = currentEpisodeEntry();
    return entry?.sources?.[state.sourceIndex] || entry?.sources?.[0] || null;
  }

  function currentPlaylist() {
    const ref = currentSourceRef();
    return ref ? playlists()[ref.playlistIndex] : null;
  }

  function currentLine() {
    const ref = currentSourceRef();
    const playlist = currentPlaylist();
    return playlist && ref ? playlist.lines[ref.lineIndex] : null;
  }

  function currentEpisode() {
    const ref = currentSourceRef();
    const line = currentLine();
    return line && ref ? line.episodes[ref.episodeIndex] : null;
  }

  function refreshEpisodeMap(nextMap) {
    if (!Array.isArray(nextMap) || !nextMap.length) return;
    const current = currentEpisodeEntry();
    episodes = nextMap;
    const nextIndex = episodes.findIndex((entry) => entry.key === current?.key);
    state.episodeIndex = nextIndex >= 0 ? nextIndex : 0;
    state.sourceIndex = Math.min(
      state.sourceIndex,
      Math.max(0, (episodes[state.episodeIndex]?.sources?.length || 1) - 1)
    );
    updateChrome();
  }

  function destroyHls() {
    if (state.hls) {
      try {
        state.hls.destroy();
      } catch {
        // ignore
      }
      state.hls = null;
    }
  }

  function setStatus(message, isError = false) {
    if (!status.isConnected) return;
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle("is-error", isError);
  }

  function clearEmbed() {
    if (!embed.isConnected) return;
    embed.hidden = true;
    embed.removeAttribute("src");
    embed.src = "about:blank";
  }

  function saveProgress(force = false) {
    if (!itemId) return;
    const episode = currentEpisode();
    const source = currentSourceRef();
    const playlist = currentPlaylist();
    if (!episode || !source) return;

    const position = Number(video.currentTime || 0);
    const duration = Number(video.duration || 0);
    if (!force && duration > 0 && position < 3) return;
    if (!force && duration > 0 && position / duration > 0.98) {
      recordWatchProgress(itemId, {
        episodeLabel: episode.label,
        episodeNid: episode.nid ?? source.episodeIndex,
        position: 0,
        duration,
        percent: 100,
        sourceId: source.sourceId,
        sourceName: source.sourceName,
        lineIndex: source.lineIndex,
        playlistIndex: source.playlistIndex,
      });
      return;
    }

    recordWatchProgress(itemId, {
      episodeLabel: episode.label,
      episodeNid: episode.nid ?? source.episodeIndex,
      position,
      duration,
      sourceId: source.sourceId,
      sourceName: playlist?.sourceName || source.sourceName,
      lineIndex: source.lineIndex,
      playlistIndex: source.playlistIndex,
    });
  }

  function startProgressTracking() {
    stopProgressTracking();
    state.progressTimer = setInterval(() => saveProgress(false), 5000);

    const onPause = () => saveProgress(true);
    const onEnded = () => saveProgress(true);
    const onHide = () => {
      if (document.visibilityState === "hidden") saveProgress(true);
    };
    const onPageHide = () => saveProgress(true);

    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);

    state.progressCleanups = [
      () => video.removeEventListener("pause", onPause),
      () => video.removeEventListener("ended", onEnded),
      () => document.removeEventListener("visibilitychange", onHide),
      () => window.removeEventListener("pagehide", onPageHide),
    ];
  }

  function stopProgressTracking() {
    if (state.progressTimer) {
      clearInterval(state.progressTimer);
      state.progressTimer = null;
    }
    (state.progressCleanups || []).forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore
      }
    });
    state.progressCleanups = [];
  }

  function stopPlayback() {
    state.requestId += 1;
    state.started = false;
    stopProgressTracking();
    saveProgress(true);
    destroyHls();
    if (video.isConnected) {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.hidden = true;
      } catch {
        // ignore
      }
    }
    clearEmbed();
    if (playStartButton.isConnected) {
      playStartButton.hidden = false;
      playStartButton.querySelector("strong").textContent =
        state.resumePosition > 0 ? "继续播放" : "立即播放";
      playStartHint.classList.remove("is-error");
    }
    if (playerFrame.isConnected) {
      playerFrame.classList.add("is-idle");
      playerFrame.classList.remove("is-loading", "is-embed");
    }
    setStatus("");
  }

  function showIdle() {
    stopPlayback();
  }

  function showLoading() {
    video.hidden = true;
    clearEmbed();
    playStartButton.hidden = true;
    playerFrame.classList.remove("is-idle", "is-embed");
    playerFrame.classList.add("is-loading");
    setStatus("正在加载视频...");
  }

  function showPlaying(mode = "video") {
    playStartButton.hidden = true;
    playerFrame.classList.remove("is-idle", "is-loading");
    if (mode === "embed") {
      video.hidden = true;
      embed.hidden = false;
      playerFrame.classList.add("is-embed");
      stopProgressTracking();
    } else {
      clearEmbed();
      video.hidden = false;
      playerFrame.classList.remove("is-embed");
      startProgressTracking();
    }
    setStatus("");
  }

  function updateChrome() {
    const entry = currentEpisodeEntry();
    const source = currentSourceRef();
    const playlist = currentPlaylist();
    const line = currentLine();
    const episode = currentEpisode();
    const episodeCountLabel = document.querySelector("#episodeCountLabel");

    if (!entry || !source || !playlist || !line || !episode) return;

    video.title = `${playlist.sourceName} ${episode.label}`;
    openLink.href = episode.pageUrl;
    meta.textContent = `${playlist.matchName} · ${line.name} · ${episode.label} · ${source.sourceName}`;
    if (!playStartHint.classList.contains("is-error")) {
      playStartHint.textContent = `${episode.label} · ${source.sourceName}`;
    }
    if (episodeCountLabel) {
      episodeCountLabel.textContent = `${episodes.length} 集 · ${entry.sources.length} 源`;
    }

    episodeTabs.querySelectorAll("button").forEach((button, index) => {
      button.classList.toggle("active", index === state.episodeIndex);
    });
    sourceChips.innerHTML = renderEpisodeSourceChips(entry, state.sourceIndex);
  }

  function resetPlayHint() {
    const source = currentSourceRef();
    const episode = currentEpisode();
    if (!episode || !source) return;
    playStartButton.querySelector("strong").textContent =
      state.resumePosition > 0 ? "继续播放" : "立即播放";
    playStartHint.classList.remove("is-error");
    playStartHint.textContent = `${episode.label} · ${source.sourceName}`;
  }

  function buildPlayCandidates(preferredOnly = false) {
    const entry = currentEpisodeEntry();
    if (!entry) return [];

    const sources = preferredOnly
      ? [entry.sources[state.sourceIndex]].filter(Boolean)
      : [
          entry.sources[state.sourceIndex],
          ...entry.sources.filter((_, index) => index !== state.sourceIndex),
        ].filter(Boolean);

    return sources.map((source) => ({
      playlistIndex: source.playlistIndex,
      lineIndex: source.lineIndex,
      episodeIndex: source.episodeIndex,
      playApi: source.playApi,
      pageUrl: source.pageUrl,
      kind: source.kind || "online",
      label: `${source.sourceName} / ${source.lineName} / ${entry.label}`,
      sourceId: source.sourceId,
      sourceName: source.sourceName,
    }));
  }

  async function seekToResume() {
    const target = state.resumePosition;
    state.resumePosition = 0;
    if (!target || target < 3) return;
    if (!Number.isFinite(video.duration) || video.duration <= target) {
      await new Promise((resolve) => {
        video.addEventListener("loadedmetadata", resolve, { once: true });
        setTimeout(resolve, 1500);
      });
    }
    if (video.duration > target + 1) {
      video.currentTime = target;
    }
  }

  async function startPlayback() {
    const requestId = ++state.requestId;
    state.started = true;
    destroyHls();
    showLoading();

    const candidates = buildPlayCandidates(true).concat(buildPlayCandidates(false));
    const seen = new Set();
    const ordered = candidates.filter((candidate) => {
      const key = `${candidate.playlistIndex}:${candidate.lineIndex}:${candidate.episodeIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let lastError = null;

    for (const candidate of ordered) {
      if (requestId !== state.requestId) return;
      if (candidate.kind === "torrent") continue;

      applyCandidate(candidate);
      setStatus(`正在尝试直链：${candidate.label}...`);

      try {
        const stream = await getStream(candidate.playApi);
        if (requestId !== state.requestId) return;
        await attachStream(video, stream, state);
        if (requestId !== state.requestId) return;
        showPlaying("video");
        await seekToResume();
        await video.play().catch(() => {});
        saveProgress(true);
        prefetchNearbyEpisodes();
        return;
      } catch (error) {
        lastError = error;
        console.warn(candidate.label, error);
        streamCache.delete(candidate.playApi);
      }
    }

    for (const candidate of ordered) {
      if (requestId !== state.requestId) return;
      if (!candidate.pageUrl || candidate.kind === "torrent") continue;
      applyCandidate(candidate);
      setStatus(`直链失败，改用原站播放器：${candidate.label}...`);

      try {
        await attachEmbed(embed, candidate.pageUrl);
        if (requestId !== state.requestId) return;
        showPlaying("embed");
        meta.textContent = `${meta.textContent} · 原站播放器`;
        return;
      } catch (error) {
        lastError = error;
        console.warn("embed", candidate.label, error);
      }
    }

    for (const candidate of ordered) {
      if (requestId !== state.requestId) return;
      if (candidate.kind !== "torrent") continue;
      applyCandidate(candidate);
      setStatus(`正在尝试 BT：${candidate.label}...`);

      try {
        const stream = await getStream(candidate.playApi);
        if (requestId !== state.requestId) return;
        await attachStream(video, stream, state);
        if (requestId !== state.requestId) return;
        showPlaying("video");
        await video.play().catch(() => {});
        return;
      } catch (error) {
        lastError = error;
        console.warn(candidate.label, error);
        streamCache.delete(candidate.playApi);
      }
    }

    if (requestId !== state.requestId) return;
    showIdle();
    playStartButton.querySelector("strong").textContent = "重试播放";
    playStartHint.textContent = lastError?.message || "暂时无法播放，请换片源或原站打开";
    playStartHint.classList.add("is-error");
  }

  function applyCandidate(candidate) {
    const entry = currentEpisodeEntry();
    if (!entry) return;
    state.sourceIndex = Math.max(
      0,
      entry.sources.findIndex(
        (source) =>
          source.playlistIndex === candidate.playlistIndex &&
          source.lineIndex === candidate.lineIndex &&
          source.episodeIndex === candidate.episodeIndex
      )
    );
    updateChrome();
  }

  function selectEpisode(nextEpisodeIndex, nextSourceIndex = 0) {
    state.episodeIndex = nextEpisodeIndex;
    state.sourceIndex = nextSourceIndex;
    state.resumePosition = 0;
    if (state.started) {
      updateChrome();
      startPlayback();
      return;
    }
    resetPlayHint();
    updateChrome();
    prefetchCurrentEpisode();
  }

  function selectSource(nextSourceIndex) {
    state.sourceIndex = nextSourceIndex;
    state.resumePosition = 0;
    if (state.started) {
      updateChrome();
      startPlayback();
      return;
    }
    resetPlayHint();
    updateChrome();
    prefetchCurrentEpisode();
  }

  function prefetchCurrentEpisode() {
    const episode = currentEpisode();
    if (!episode?.playApi || streamCache.has(episode.playApi)) return;
    getStream(episode.playApi).catch(() => {});
  }

  function prefetchNearbyEpisodes() {
    [state.episodeIndex, state.episodeIndex + 1, state.episodeIndex + 2].forEach((index) => {
      const entry = episodes[index];
      const source = entry?.sources?.[0];
      if (!source?.playApi || streamCache.has(source.playApi)) return;
      getStream(source.playApi).catch(() => {});
    });
  }

  playStartButton.addEventListener("click", () => {
    resetPlayHint();
    startPlayback();
  });

  episodeTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-episode-index]");
    if (!button) return;
    selectEpisode(Number(button.dataset.episodeIndex), 0);
  });

  sourceChips.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-source-index]");
    if (!button) return;
    selectSource(Number(button.dataset.sourceIndex));
  });

  stopPlayback();
  updateChrome();
  prefetchCurrentEpisode();

  return {
    refreshEpisodeMap,
    stop: stopPlayback,
  };
}

function findInitialSourceIndex(entry, resume) {
  if (!entry?.sources?.length) return 0;
  if (!resume?.sourceId) return 0;
  const index = entry.sources.findIndex(
    (source) =>
      source.sourceId === resume.sourceId &&
      (resume.lineIndex == null || source.lineIndex === resume.lineIndex)
  );
  return index >= 0 ? index : 0;
}

async function getStream(playApi) {
  if (streamCache.has(playApi)) {
    return streamCache.get(playApi);
  }

  const pending = fetchSourcePlay(playApi)
    .then((stream) => {
      streamCache.set(playApi, stream);
      return stream;
    })
    .catch((error) => {
      streamCache.delete(playApi);
      throw error;
    });

  streamCache.set(playApi, pending);
  return pending;
}

async function fetchSourcePlay(playApi) {
  const response = await fetch(playApi);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `播放解析失败: ${response.status}`);
  }
  if (!payload.url && (payload.pageUrl || payload.embedUrl)) {
    const error = new Error(payload.error || "需要原站嵌入播放");
    error.pageUrl = payload.pageUrl || payload.embedUrl;
    error.embedOnly = true;
    throw error;
  }
  if (!payload.url) {
    throw new Error(payload.error || "未获取到可播放地址");
  }
  return payload;
}

function attachStream(video, stream, state) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(() => {
      finish(new Error("视频加载超时，请换片源或原站打开"));
    }, 20000);

    destroyAttachedHls(state);
    video.pause();
    video.removeAttribute("src");
    video.load();

    if (stream.type === "hls") {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = stream.url;
        video.addEventListener("loadedmetadata", () => finish(), { once: true });
        video.addEventListener("error", () => finish(new Error("视频加载失败，请换片源")), {
          once: true,
        });
        return;
      }

      if (window.Hls?.isSupported()) {
        const hls = new window.Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 30,
        });
        state.hls = hls;
        hls.loadSource(stream.url);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => finish());
        hls.on(window.Hls.Events.ERROR, (_event, data) => {
          if (data?.fatal) {
            finish(new Error("HLS 播放失败，请换片源"));
          }
        });
        return;
      }

      finish(new Error("当前浏览器不支持 HLS 播放"));
      return;
    }

    video.src = stream.url;
    video.addEventListener("loadedmetadata", () => finish(), { once: true });
    video.addEventListener("error", () => finish(new Error("视频加载失败，请换片源")), {
      once: true,
    });
  });
}

function destroyAttachedHls(state) {
  if (state?.hls) {
    state.hls.destroy();
    state.hls = null;
  }
}

function attachEmbed(iframe, pageUrl) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      iframe.removeEventListener("load", onLoad);
      iframe.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve();
    };

    const onLoad = () => finish();
    const onError = () => finish(new Error("原站播放器加载失败"));
    const timer = setTimeout(() => finish(), 2500);

    iframe.addEventListener("load", onLoad, { once: true });
    iframe.addEventListener("error", onError, { once: true });
    iframe.src = pageUrl;
  });
}

export function renderEpisodeTabs(episodes, activeIndex) {
  return episodes
    .map(
      (episode, index) => `
        <button
          class="${index === activeIndex ? "active" : ""}"
          type="button"
          data-episode-index="${index}"
        >
          ${escapeHtml(episode.label)}
        </button>
      `
    )
    .join("");
}

export function renderLineTabs(lines, activeIndex) {
  return lines
    .map(
      (line, index) => `
        <button
          class="${index === activeIndex ? "active" : ""}"
          type="button"
          data-line-index="${index}"
        >
          ${escapeHtml(line.name)}
        </button>
      `
    )
    .join("");
}
