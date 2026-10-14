import { renderEpisodeSourceChips, sourceOptionLabel } from "./episode-sources.js";
import { recordWatchProgress } from "./watch-history.js";
import { escapeHtml } from "./utils.js";
import { apiError, isVerifyError } from "./sources.js";
import { createNativeVideo, nativePlayerAvailable } from "./native/native-player.js";

const streamCache = new Map();
const MAX_LINES_PER_SOURCE = 2;
const MAX_PLAY_ATTEMPTS = 6;
const PLAY_RESOLVE_TIMEOUT_MS = 45000;
const MIN_EPISODE_SECONDS = 30;

export function bindSourcePlayer(playlistState, episodeSourceMap, context = {}) {
  const video = document.querySelector("#sourcePlayer");
  const playerFrame = document.querySelector("#playerFrame");
  const playStartButton = document.querySelector("#playStartButton");
  const playStartHint = document.querySelector("#playStartHint");
  const episodeTabs = document.querySelector("#episodeTabs");
  const sourceChips = document.querySelector("#episodeSourceChips");
  const meta = document.querySelector("#sourcePlayerMeta");
  const status = document.querySelector("#sourcePlayerStatus");
  if (
    !video ||
    !playerFrame ||
    !playStartButton ||
    !playStartHint ||
    !episodeTabs ||
    !sourceChips ||
    !meta ||
    !status
  ) {
    return null;
  }

  let episodes = episodeSourceMap;
  // The <video> element, or on Android the libmpv player behind the same interface.
  let media = video;
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
    const currentSource = currentSourceRef();
    episodes = nextMap;
    const nextIndex = episodes.findIndex((entry) => entry.key === current?.key);
    state.episodeIndex = nextIndex >= 0 ? nextIndex : 0;
    const sources = episodes[state.episodeIndex]?.sources || [];
    const sameSource = currentSource
      ? sources.findIndex(
          (source) =>
            source.playlistIndex === currentSource.playlistIndex &&
            source.lineIndex === currentSource.lineIndex &&
            source.episodeIndex === currentSource.episodeIndex
        )
      : -1;
    state.sourceIndex = sameSource >= 0 ? sameSource : 0;
    episodeTabs.innerHTML = renderEpisodeTabs(
      episodes.map((entry) => ({ label: entry.label, nid: entry.nid })),
      state.episodeIndex
    );
    episodeTabs.classList.toggle("is-text", hasTextEpisodes(episodes));
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
    const embed = document.querySelector("#sourceEmbed");
    if (!embed?.isConnected) return;
    embed.hidden = true;
    embed.removeAttribute("src");
    embed.src = "about:blank";
  }

  function resolvePlayEpisodeNumber(episode, source) {
    const fromLabel = String(episode?.label || "").match(/(\d{1,4})/);
    if (fromLabel) {
      const value = Number(fromLabel[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    if (episode?.nid != null && Number(episode.nid) > 0) return Number(episode.nid);
    return Number(source?.episodeIndex || 0) + 1;
  }

  function saveProgress(force = false) {
    if (!itemId) return;
    const episode = currentEpisode();
    const source = currentSourceRef();
    const playlist = currentPlaylist();
    if (!episode || !source) return;

    const position = Number(media.currentTime || 0);
    const duration = Number(media.duration || 0);
    if (!force && duration > 0 && position < 3) return;
    const episodeNumber = resolvePlayEpisodeNumber(episode, source);
    if (!force && duration > 0 && position / duration > 0.98) {
      recordWatchProgress(itemId, {
        episodeLabel: episode.label,
        episodeNid: episode.nid ?? source.episodeIndex,
        episodeNumber,
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
      episodeNumber,
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

    const player = media;
    const onPause = () => saveProgress(true);
    const onEnded = () => {
      saveProgress(true);
      if (player.isNative) playNextEpisode();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") saveProgress(true);
    };
    const onPageHide = () => saveProgress(true);

    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);

    state.progressCleanups = [
      () => player.removeEventListener("pause", onPause),
      () => player.removeEventListener("ended", onEnded),
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
    if (media.isNative) media.stop();
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

  function showPlaying() {
    playStartButton.hidden = true;
    playerFrame.classList.remove("is-idle", "is-loading", "is-embed");
    clearEmbed();
    video.hidden = Boolean(media.isNative);
    startProgressTracking();
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
    meta.textContent = `${playlist.matchName} · ${line.name} · ${episode.label} · ${source.sourceName}`;
    const episodeValue = document.querySelector("#episodeDropdownValue");
    const sourceValue = document.querySelector("#sourceDropdownValue");
    if (episodeValue) episodeValue.textContent = entry.label;
    if (sourceValue) sourceValue.textContent = sourceOptionLabel(source);
    if (!playStartHint.classList.contains("is-error")) {
      playStartHint.textContent = `${episode.label} · ${source.sourceName}`;
    }
    if (episodeCountLabel) {
      episodeCountLabel.textContent = `${episodes.length} 集 · ${entry.sources.length} 源`;
    }

    episodeTabs.querySelectorAll("[data-episode-index]").forEach((button, index) => {
      const active = index === state.episodeIndex;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    revealActiveEpisode();
    sourceChips.innerHTML = renderEpisodeSourceChips(entry, state.sourceIndex);
  }

  // Scrolls only the episode list, never the page.
  function revealActiveEpisode() {
    const active = episodeTabs.querySelector(".episode-tile.active");
    if (!active || !episodeTabs.clientWidth) return;
    episodeTabs.scrollLeft = active.offsetLeft - (episodeTabs.clientWidth - active.offsetWidth) / 2;
    episodeTabs.scrollTop = active.offsetTop - (episodeTabs.clientHeight - active.offsetHeight) / 2;
  }

  function resetPlayHint() {
    const source = currentSourceRef();
    const episode = currentEpisode();
    if (!episode || !source) return;
    playStartButton.querySelector("strong").textContent =
      state.resumePosition > 0 ? "继续播放" : "立即播放";
    playStartHint.classList.remove("is-error");
    playerFrame.classList.remove("is-failed", "needs-verify");
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

  async function prepareMedia() {
    if (media.isNative || !(await nativePlayerAvailable())) return;
    if (media.isNative) return;
    media = createNativeVideo(playerFrame, {
      onNext: playNextEpisode,
      onEpisode: playEpisodeAt,
      onBack: () => document.querySelector("#playerBackButton")?.click(),
    });
  }

  function nativeInfo() {
    const playlist = currentPlaylist();
    const episode = currentEpisode();
    return {
      title: [playlist?.matchName, episode?.label].filter(Boolean).join(" · "),
      hasNext: state.episodeIndex < episodes.length - 1,
      episodes: episodes.map((entry) => String(entry.label)),
      episodeIndex: state.episodeIndex,
    };
  }

  async function attachMedia(stream) {
    if (!media.isNative) {
      await attachStream(video, stream, state);
      return;
    }
    await media.attach(stream, state.resumePosition, nativeInfo());
    if (media.duration > 0 && media.duration < MIN_EPISODE_SECONDS) {
      throw new Error("片源返回的是占位短片，请换片源");
    }
    state.resumePosition = 0;
  }

  function playNextEpisode() {
    playEpisodeAt(state.episodeIndex + 1);
  }

  function playEpisodeAt(nextIndex) {
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex === state.episodeIndex) return;
    if (nextIndex >= episodes.length) return;
    const lineIndex = currentSourceRef()?.lineIndex;
    const sameLine = (episodes[nextIndex]?.sources || []).findIndex((source) => source.lineIndex === lineIndex);
    selectEpisode(nextIndex, Math.max(0, sameLine));
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
    playerFrame.classList.remove("is-failed", "needs-verify");
    await prepareMedia();
    if (requestId !== state.requestId) return;

    if (media.isNative) media.setInfo({ ...nativeInfo(), loading: true });

    const candidates = context.singleSource
      ? buildPlayCandidates(true)
      : buildPlayCandidates(true).concat(buildPlayCandidates(false));
    const seen = new Set();
    const perSource = new Map();
    const ordered = candidates
      .filter((candidate) => {
        const key = `${candidate.playlistIndex}:${candidate.lineIndex}:${candidate.episodeIndex}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const tried = perSource.get(candidate.sourceId) || 0;
        if (tried >= MAX_LINES_PER_SOURCE) return false;
        perSource.set(candidate.sourceId, tried + 1);
        return true;
      })
      .slice(0, MAX_PLAY_ATTEMPTS);

    let lastError = null;

    for (const candidate of ordered) {
      if (requestId !== state.requestId) return;
      if (candidate.kind === "torrent") continue;

      applyCandidate(candidate);
      setStatus(`正在尝试直链：${candidate.label}...`);

      try {
        const stream = await getStream(candidate.playApi);
        if (requestId !== state.requestId) return;
        await attachMedia(stream);
        if (requestId !== state.requestId) return;
        document.dispatchEvent(new CustomEvent("anime:source-playback", { detail: { source: candidate.sourceId, ok: true, label: candidate.label } }));
        showPlaying();
        await seekToResume();
        await media.play().catch(() => {});
        saveProgress(true);
        prefetchNearbyEpisodes();
        return;
      } catch (error) {
        lastError = error;
        if (requestId !== state.requestId) return;
        document.dispatchEvent(new CustomEvent("anime:source-playback", { detail: { source: candidate.sourceId, ok: false, label: candidate.label, error: error.message } }));
        console.warn(candidate.label, error);
        streamCache.delete(candidate.playApi);
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
        await attachMedia(stream);
        if (requestId !== state.requestId) return;
        showPlaying();
        await media.play().catch(() => {});
        return;
      } catch (error) {
        lastError = error;
        console.warn(candidate.label, error);
        streamCache.delete(candidate.playApi);
      }
    }

    if (requestId !== state.requestId) return;
    showIdle();
    playerFrame.classList.add("is-failed");
    playStartButton.querySelector("strong").textContent = "重试";
    if (isVerifyError(lastError)) {
      playerFrame.classList.add("needs-verify");
      playerFrame.dataset.verify = JSON.stringify(lastError.verify || {});
      playStartHint.textContent = "该网站需要先完成验证，验证后点重试";
    } else {
      playStartHint.textContent = `${(lastError?.message || "解析失败").replace(/，请换.*$/, "")}，可以重试或更换片源`;
    }
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
    if (!episodes[nextEpisodeIndex]) return;
    saveProgress(true);
    stopProgressTracking();
    state.episodeIndex = nextEpisodeIndex;
    state.sourceIndex = nextSourceIndex;
    state.resumePosition = 0;
    closeOptionDropdowns();
    if (state.started || context.autoplay) {
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
    closeOptionDropdowns();
    if (state.started || context.autoplay) {
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
    const nextIndex = Number(button.dataset.episodeIndex);
    const lineIndex = currentSourceRef()?.lineIndex;
    const sameLine = (episodes[nextIndex]?.sources || []).findIndex((source) => source.lineIndex === lineIndex);
    selectEpisode(nextIndex, Math.max(0, sameLine));
  });

  sourceChips.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-source-index]");
    if (!button) return;
    selectSource(Number(button.dataset.sourceIndex));
  });

  const episodeExpand = document.querySelector("[data-episode-expand]");
  episodeExpand?.addEventListener("click", () => {
    const section = episodeTabs.closest(".episode-selector");
    const expanded = !section?.classList.contains("is-expanded");
    section?.classList.toggle("is-expanded", expanded);
    episodeExpand.textContent = expanded ? "收起" : "全部";
    episodeExpand.setAttribute("aria-expanded", expanded ? "true" : "false");
    requestAnimationFrame(revealActiveEpisode);
  });

  document.querySelectorAll(".option-dropdown").forEach(bindOptionDropdown);
  if (!document.documentElement.dataset.optionDropdownBound) {
    document.documentElement.dataset.optionDropdownBound = "1";
    document.addEventListener("click", () => closeOptionDropdowns());
  }

  document.querySelector("#playerSkip85")?.addEventListener("click", () => {
    if (!state.started || !(media.duration > 0)) return;
    const limit = Number.isFinite(media.duration) && media.duration > 0 ? Math.max(0, media.duration - 1) : Infinity;
    media.currentTime = Math.min(limit, Math.max(0, media.currentTime || 0) + 85);
  });
  stopPlayback();
  updateChrome();
  if (context.autoplay) startPlayback();
  else prefetchCurrentEpisode();

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
  const response = await fetch(playApi, { signal: AbortSignal.timeout(PLAY_RESOLVE_TIMEOUT_MS) }).catch(
    (error) => {
      throw new Error(error?.name === "TimeoutError" ? "解析播放地址超时" : error?.message || "解析失败");
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw apiError(payload, `播放解析失败: ${response.status}`);
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
      finish(new Error("视频加载超时，请换一条片源"));
    }, 20000);

    destroyAttachedHls(state);
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.preload = "auto";

    if (stream.type === "hls") {
      if (!window.Hls?.isSupported() && video.canPlayType("application/vnd.apple.mpegurl")) {
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
    video.addEventListener(
      "loadedmetadata",
      () =>
        finish(
          video.duration < MIN_EPISODE_SECONDS
            ? new Error("片源返回的是占位短片，请换片源")
            : null
        ),
      { once: true }
    );
    video.addEventListener("error", () => finish(new Error("视频加载失败，请换片源")), {
      once: true,
    });
  });
}

function closeOptionDropdowns() {
  document.querySelectorAll(".option-dropdown.is-open").forEach((root) => {
    root.classList.remove("is-open");
    const menu = root.querySelector(".option-dropdown-menu");
    const trigger = root.querySelector(".option-dropdown-trigger");
    if (menu) menu.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
  });
}

function bindOptionDropdown(root) {
  const trigger = root.querySelector(".option-dropdown-trigger");
  const menu = root.querySelector(".option-dropdown-menu");
  if (!trigger || !menu || trigger.dataset.dropdownBound === "1") return;
  trigger.dataset.dropdownBound = "1";
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menu.hidden;
    closeOptionDropdowns();
    if (!willOpen) return;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    root.classList.add("is-open");
  });
}

function destroyAttachedHls(state) {
  if (state?.hls) {
    state.hls.destroy();
    state.hls = null;
  }
}

const EPISODE_NUMBER = /^(?:第\s*)?0*(\d{1,4}(?:\.\d)?)\s*(?:集|话|話|回|期)?$|^(?:EP?|#)\s*0*(\d{1,4})$/i;

function episodeNumber(label) {
  const match = String(label || "").trim().match(EPISODE_NUMBER);
  return match ? match[1] || match[2] : "";
}

export function hasTextEpisodes(episodes) {
  return episodes.some((episode) => !episodeNumber(episode.label));
}

export function renderEpisodeTabs(episodes, activeIndex) {
  return episodes
    .map((episode, index) => {
      const number = episodeNumber(episode.label);
      const active = index === activeIndex;
      return `
        <button
          class="episode-tile${active ? " active" : ""}"
          type="button"
          role="option"
          aria-selected="${active ? "true" : "false"}"
          title="${escapeHtml(episode.label)}"
          data-episode-index="${index}"
        >
          <span>${escapeHtml(number || episode.label)}</span>
          <i class="episode-playing" aria-hidden="true"><b></b><b></b><b></b></i>
        </button>
      `;
    })
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
