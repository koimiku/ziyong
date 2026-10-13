import { authorizedPlayers, allowedEmbedHosts } from "./config.js";
import { isTokusatsuMode } from "./content-mode.js";
import { isTokusatsuItem } from "./tokusatsu.js";
import { appShell, detailPanel } from "./dom.js";
import { getPosterUrl } from "./bangumi.js";
import {
  buildEpisodeSourceMap,
  findEpisodeIndex,
  findSourceIndex,
  renderEpisodeSourceChips,
  sourceOptionLabel,
} from "./episode-sources.js";
import { bindSourcePlayer, renderEpisodeTabs } from "./player.js";
import { initializeMobile, syncMobileWatchState } from "./mobile.js";
import {
  getSourceNamesText,
  loadSourcePlaylist,
  prepareWatchSearch,
  searchSourceForItem,
} from "./sources.js";
import { createRetrievalPanel } from "./source-retrieval.js";
import {
  cleanSynopsis,
  escapeAttribute,
  escapeHtml,
  pickDisplayTitle,
} from "./utils.js";
import { getWatchProgress, recordWatch } from "./watch-history.js";
import { createSourceProgress } from "./source-progress.js";

let activePlayerController = null;
let lastCardOrigin = null;

document.addEventListener(
  "click",
  (event) => {
    const card = event.target.closest?.(".anime-card, .hero-card, .calendar-card");
    if (!card) return;
    const poster = card.querySelector("img") || card;
    lastCardOrigin = { rect: poster.getBoundingClientRect(), time: performance.now() };
  },
  true
);

function playCardExpansion() {
  const origin = lastCardOrigin;
  lastCardOrigin = null;
  if (!origin || performance.now() - origin.time > 1500) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const page = detailPanel.querySelector(".entry-page");
  const cover = detailPanel.querySelector(".entry-cover");
  if (!page || !cover || typeof cover.animate !== "function") return;
  const target = cover.getBoundingClientRect();
  const from = origin.rect;
  if (!target.width || !target.height || !from.width || !from.height) return;

  const ghost = cover.cloneNode();
  ghost.removeAttribute("id");
  ghost.className = "entry-cover-ghost";
  Object.assign(ghost.style, {
    left: `${target.left}px`,
    top: `${target.top}px`,
    width: `${target.width}px`,
    height: `${target.height}px`,
  });
  document.body.append(ghost);
  page.classList.add("is-expanding");
  const dx = from.left - target.left;
  const dy = from.top - target.top;
  const sx = from.width / target.width;
  const sy = from.height / target.height;
  const animation = ghost.animate(
    [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: "none" }],
    { duration: 460, easing: "cubic-bezier(.2, 0, 0, 1)" }
  );
  const done = () => {
    ghost.remove();
    page.classList.remove("is-expanding");
  };
  animation.addEventListener("finish", done);
  animation.addEventListener("cancel", done);
}

export function stopActivePlayback() {
  if (activePlayerController?.stop) {
    activePlayerController.stop();
  }
  activePlayerController = null;

  document.querySelectorAll("video").forEach((video) => {
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {
      // ignore
    }
  });
  document.querySelectorAll("iframe#sourceEmbed, iframe[src*='play'], iframe[src*='watch']").forEach((frame) => {
    try {
      frame.removeAttribute("src");
    } catch {
      // ignore
    }
  });
}

export function exitWatchMode() {
  stopActivePlayback();
  appShell.classList.remove("is-watching");
  detailPanel.dataset.requestId = "";
  detailPanel.innerHTML = `
    <div class="empty-state">
      <h2>${isTokusatsuMode() ? "选择一部特摄" : "选择一部番剧"}</h2>
      <p>这里会显示简介、别名、播出信息，并自动匹配 ${getSourceNamesText()} 的观看入口。</p>
    </div>
  `;
  syncMobileWatchState();
  document.dispatchEvent(new CustomEvent("anime:watch-ended"));
}

export async function showDetails(item, options = {}) {
  stopActivePlayback();
  recordWatch(item);

  const title = pickDisplayTitle(item);
  const resume = options.resume ?? getWatchProgress(item.id);
  const players = getAuthorizedPlayers(item.id);
  const requestId = `${item.id}-${Date.now()}`;
  detailPanel.dataset.requestId = requestId;
  appShell.classList.add("is-watching");
  syncMobileWatchState();

  detailPanel.innerHTML = renderEntryShell(item, title, players, resume);
  playCardExpansion();

  document.querySelector("#watchBackButton")?.addEventListener("click", () => {
    exitWatchMode();
  });

  bindPlayerControls(players);

  const progress = createSourceProgress(document.querySelector("#sourceSection"));
  const { sources, queries, preset } = await prepareWatchSearch(item);
  if (detailPanel.dataset.requestId !== requestId) return;

  runSourceRetrieval({ item, title, resume, requestId, sources, queries, preset, progress });
}

// Each source searches and loads on its own; the player mounts as soon as a
// preferred source is playable and later sources merge into the episode map.
function runSourceRetrieval({ item, title, resume, requestId, sources, queries, preset, progress }) {
  const isCurrent = () => detailPanel.dataset.requestId === requestId;
  const results = new Map();
  const playlistState = { items: [] };
  const deferredTorrents = [];
  let playerApi = null;
  let mounted = false;
  let fallbackShown = false;
  let outstanding = 0;
  let graceTimer = null;

  const keywords = [...new Set([...queries, ...(item.aliases || [])].map((v) => String(v).trim()).filter(Boolean))].slice(0, 6);
  const panel = createRetrievalPanel({
    keywords,
    onRetry: (source) => runSource(source, queries),
    onKeyword: (targets, keyword) => targets.forEach((source) => runSource(source, [keyword], { minScore: 55 })),
  });

  const watchSupport = document.querySelector("#watchSupport");
  if (watchSupport) {
    watchSupport.insertAdjacentHTML(
      "beforeend",
      `<section class="entry-panel source-retrieval" id="sourceRetrievalPanel" aria-label="片源检索"></section>`
    );
  }
  panel.setSources(sources);
  progress.onProgress({ type: "start", sources });

  function isPreferred(playlist) {
    if (resume?.sourceId) return playlist.sourceId === resume.sourceId;
    return playlist.speedRank < 6;
  }

  function mount() {
    if (mounted || !isCurrent()) return;
    const sourceSection = document.querySelector("#sourceSection");
    const support = document.querySelector("#watchSupport");
    if (!sourceSection || !support) return;
    clearTimeout(graceTimer);
    mounted = true;
    playlistState.items.sort((a, b) => a.speedRank - b.speedRank || b.matchScore - a.matchScore);
    playlistState.items.push(...deferredTorrents.splice(0));
    const episodeSourceMap = buildEpisodeSourceMap(playlistState.items);
    const rendered = renderWatchPanels(
      [...results.values()],
      playlistState.items,
      episodeSourceMap,
      item,
      title,
      resume
    );
    sourceSection.innerHTML = rendered.player;
    support.innerHTML = rendered.support;
    panel.render();
    playerApi = bindSourcePlayer(playlistState, episodeSourceMap, { itemId: item.id, resume });
    activePlayerController = playerApi;
  }

  function showFallback() {
    if (mounted || fallbackShown || !isCurrent()) return;
    const sourceSection = document.querySelector("#sourceSection");
    const support = document.querySelector("#watchSupport");
    if (!sourceSection || !support) return;
    fallbackShown = true;
    sourceSection.innerHTML = renderSourceFallback();
    support.innerHTML = renderEmptySupport(item, title, [...results.values()]);
    panel.render();
  }

  function addPlaylist(playlist) {
    if (playlist.kind === "torrent" && !mounted) {
      deferredTorrents.push(playlist);
      return;
    }
    playlistState.items.push(playlist);
    if (mounted) {
      if (activePlayerController === playerApi) {
        playerApi?.refreshEpisodeMap?.(buildEpisodeSourceMap(playlistState.items));
      }
      return;
    }
    if (isPreferred(playlist)) {
      mount();
    } else if (!graceTimer) {
      graceTimer = setTimeout(mount, 2500);
    }
  }

  function settle() {
    if (outstanding > 0 || !isCurrent()) return;
    if (playlistState.items.length) mount();
    else showFallback();
  }

  async function runSource(source, sourceQueries, options = {}) {
    if (!isCurrent()) return;
    outstanding += 1;
    panel.update(source.id, { state: "pending", matchName: "" });
    const initial = !results.has(source.id);
    try {
      const matches = preset.get(source.id) || (await searchSourceForItem(source, sourceQueries, options));
      if (!isCurrent()) return;
      results.set(source.id, { source, matches, error: null });
      if (initial) progress.onProgress({ type: "source", source, state: matches.length ? "found" : "empty", count: matches.length });
      if (!matches.length) {
        panel.update(source.id, { state: "empty" });
        return;
      }
      panel.update(source.id, { state: "loading", matchName: matches[0].name });
      const playlist = await loadSourcePlaylist({ source, matches });
      if (!isCurrent()) return;
      if (!playlist) {
        panel.update(source.id, { state: "nolines" });
        return;
      }
      const episodes = Math.max(...playlist.lines.map((line) => line.episodes?.length || 0));
      panel.update(source.id, { state: "ready", matchName: playlist.matchName, episodes });
      addPlaylist(playlist);
    } catch (error) {
      console.warn(source.id, error);
      if (!isCurrent()) return;
      results.set(source.id, { source, matches: [], error });
      if (initial) progress.onProgress({ type: "source", source, state: "error", count: 0 });
      panel.update(source.id, { state: "error", error: describeSourceError(error) });
    } finally {
      outstanding -= 1;
      settle();
    }
  }

  if (!sources.length) {
    showFallback();
    return;
  }
  sources.forEach((source) => runSource(source, queries));
}

function describeSourceError(error) {
  const message = String(error?.message || "");
  if (message.includes("超时")) return "检索超时";
  if (/captcha|验证码|站点验证/i.test(message)) return "需要站点验证";
  const status = message.match(/\b([45]\d\d)\b/);
  if (status) return `站点返回 ${status[1]}`;
  if (/fetch|network|Failed/i.test(message)) return "连接失败";
  return "检索失败";
}

function renderEntryShell(item, title, players, resume) {
  const tokusatsu = isTokusatsuItem(item);
  const poster = escapeAttribute(getPosterUrl(item));
  const resumeHint = resume?.episodeLabel
    ? `<p class="entry-resume-hint">上次看到 ${escapeHtml(resume.episodeLabel)}${
        resume.percent && resume.percent < 98 ? ` · ${resume.percent}%` : ""
      }</p>`
    : "";

  return `
    <div class="entry-page">
      <header class="entry-topbar">
        <button class="ghost-button watch-back" id="watchBackButton" type="button">← 返回</button>
        <div class="entry-topbar-text">
          <p class="eyebrow">${tokusatsu ? "特摄详情" : "番剧详情"}</p>
          <h2 id="watchTitle">${escapeHtml(title)}</h2>
        </div>
      </header>

      <section class="entry-hero" aria-label="${tokusatsu ? "特摄信息" : "番剧信息"}">
        <div class="entry-hero-backdrop" style="background-image:url('${poster}')"></div>
        <div class="entry-hero-content">
          <img class="entry-cover" src="${poster}" alt="${escapeAttribute(title)} 海报" />
          <div class="entry-hero-info">
            <h1>${escapeHtml(title)}</h1>
            <p class="entry-aliases">${escapeHtml(item.aliases.join(" / "))}</p>
            ${resumeHint}
            <div class="detail-stats entry-stats">
              <div class="stat"><strong>${escapeHtml(item.displayType || (tokusatsu ? "特摄" : "动画"))}</strong><span>类型</span></div>
              <div class="stat"><strong>${escapeHtml(String(item.episodes || "未知"))}</strong><span>集数</span></div>
              <div class="stat"><strong>${escapeHtml(tokusatsu ? String(item.year || "未知") : String(item.score || "暂无"))}</strong><span>${tokusatsu ? "年份" : "评分"}</span></div>
            </div>
          </div>
        </div>
      </section>

      <div class="entry-body">
        <section class="entry-player-column" aria-label="播放器">
          ${renderPlayerSection(players)}
          <div class="watch-player-slot" id="sourceSection">
            <div class="source-loading">正在匹配在线片源：${escapeHtml(getSourceNamesText())}...</div>
          </div>
        </section>
        <aside class="entry-sidebar" id="watchSupport" aria-label="选集与片源">
          <div class="watch-support-loading">正在加载剧集与多源线路...</div>
        </aside>
      </div>
    </div>
  `;
}

function getAuthorizedPlayers(bangumiId) {
  return authorizedPlayers
    .filter((player) => player.bangumiId === bangumiId || player.subjectId === bangumiId)
    .filter((player) => isAllowedEmbedUrl(player.embedUrl));
}

function renderWatchPanels(sourceResults, playlists, episodeSourceMap, item, title, resume) {
  if (!playlists.length) {
    return {
      player: renderSourceFallback(),
      support: renderEmptySupport(item, title, sourceResults),
    };
  }

  const episodeIndex = findEpisodeIndex(episodeSourceMap, resume);
  const episodeEntry = episodeSourceMap[episodeIndex] || episodeSourceMap[0];
  const sourceIndex = findSourceIndex(episodeEntry, resume);
  const initialSource = episodeEntry?.sources?.[sourceIndex] || episodeEntry?.sources?.[0];
  const initialPlaylist = initialSource
    ? playlists[initialSource.playlistIndex]
    : playlists[0];
  const initialLine = initialSource
    ? initialPlaylist.lines[initialSource.lineIndex]
    : initialPlaylist.lines[0];
  const initialEpisode = initialSource
    ? initialLine.episodes[initialSource.episodeIndex]
    : initialLine.episodes[0];

  return {
    player: `
      <div class="player-section source-player" aria-label="在线播放器">
        <div class="player-frame is-idle" id="playerFrame">
          <video
            id="sourcePlayer"
            controls
            playsinline
            preload="none"
            hidden
            title="${escapeAttribute(`${initialPlaylist.sourceName} ${initialEpisode.label}`)}"
          ></video>
          <div class="player-status" id="sourcePlayerStatus" hidden></div>
          <button class="play-start-button" id="playStartButton" type="button">
            <span class="play-start-icon" aria-hidden="true">▶</span>
            <strong>${resume?.position > 0 ? "继续播放" : "立即播放"}</strong>
            <em id="playStartHint">${escapeHtml(initialEpisode.label)} · ${escapeHtml(initialPlaylist.sourceName)}</em>
          </button>
        </div>
        <div class="player-meta" id="sourcePlayerMeta">
          ${escapeHtml(initialPlaylist.matchName)} · ${escapeHtml(initialLine.name)} · ${escapeHtml(initialEpisode.label)}
        </div>
      </div>
    `,
    support: `
      <section class="episode-selector entry-panel" aria-label="剧集列表">
        <div class="support-section-title">
          <strong>选集</strong>
          <span id="episodeCountLabel">${episodeSourceMap.length} 集</span>
        </div>
        <div class="option-dropdown" id="episodeDropdown">
          <button class="option-dropdown-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span id="episodeDropdownValue">${escapeHtml(episodeEntry?.label || "选择集数")}</span>
            <span class="option-dropdown-caret" aria-hidden="true"></span>
          </button>
          <div class="option-dropdown-menu" id="episodeTabs" role="listbox" hidden>
            ${renderEpisodeTabs(
              episodeSourceMap.map((entry) => ({ label: entry.label, nid: entry.nid })),
              episodeIndex
            )}
          </div>
        </div>
      </section>

      <section class="media-selector entry-panel" aria-label="同集多源">
        <div class="support-section-title">
          <strong>片源线路</strong>
        </div>
        <div class="option-dropdown" id="sourceDropdown">
          <button class="option-dropdown-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span id="sourceDropdownValue">${escapeHtml(sourceOptionLabel(initialSource || {}) || "选择片源")}</span>
            <span class="option-dropdown-caret" aria-hidden="true"></span>
          </button>
          <div class="option-dropdown-menu" id="episodeSourceChips" role="listbox" hidden>
            ${renderEpisodeSourceChips(episodeEntry, sourceIndex)}
          </div>
        </div>
      </section>

      <section class="entry-panel source-retrieval" id="sourceRetrievalPanel" aria-label="片源检索"></section>

      <section class="watch-summary entry-panel">
        <div class="support-section-title"><strong>简介</strong></div>
        <p class="summary">${escapeHtml(cleanSynopsis(item.synopsis))}</p>
        ${renderTags(item.tags)}
        ${renderBangumiLink(item)}
        ${renderAlternateMatches(sourceResults)}
      </section>
    `,
  };
}

function renderEmptySupport(item, title, sourceResults) {
  return `
    <section class="entry-panel source-retrieval" id="sourceRetrievalPanel" aria-label="片源检索"></section>
    <section class="watch-summary entry-panel">
      <div class="watch-subject">
        <img class="watch-cover" src="${escapeAttribute(getPosterUrl(item))}" alt="${escapeAttribute(title)} 海报" />
        <div>
          <h3 class="watch-subject-title">${escapeHtml(title)}</h3>
          <p class="watch-subject-subtitle">${escapeHtml(item.aliases.join(" / "))}</p>
        </div>
      </div>
      <p class="summary">${escapeHtml(cleanSynopsis(item.synopsis))}</p>
      ${renderTags(item.tags)}
      ${renderBangumiLink(item)}
      ${renderAlternateMatches(sourceResults)}
    </section>
  `;
}

function renderBangumiLink(item) {
  if (!item.sourceUrl) return "";
  return `
    <div class="link-list">
      <a class="watch-link" href="${escapeAttribute(item.sourceUrl)}" target="_blank" rel="noreferrer">
        <span>Bangumi 条目</span>
        <span aria-hidden="true">↗</span>
      </a>
    </div>
  `;
}

function renderSourceFallback() {
  return `
    <div class="source-header">
      <strong>在线观看</strong>
      <span>暂时没有片源找到这部番，可以在「片源检索」里换个名字或重试失败的片源。</span>
    </div>
  `;
}

function renderAlternateMatches(sourceResults) {
  const extras = sourceResults.flatMap(({ source, matches }) =>
    matches.slice(1).map((match) => ({ source, match }))
  );

  if (!extras.length) return "";

  return `
    <div class="option-dropdown">
      <button class="option-dropdown-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
        <span>其他匹配 · ${extras.length}</span>
        <span class="option-dropdown-caret" aria-hidden="true"></span>
      </button>
      <div class="option-dropdown-menu" role="listbox" hidden>
        ${extras
          .map(
            ({ source, match }) => `
              <a class="option-dropdown-item" href="${escapeAttribute(match.url)}" target="_blank" rel="noreferrer">
                ${escapeHtml(source.name)} · ${escapeHtml(match.name)}
              </a>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderTags(tags = []) {
  const visibleTags = tags.filter((tag) => tag?.name).slice(0, 18);
  if (!visibleTags.length) return "";

  return `
    <section class="tag-section" aria-label="Bangumi 标签">
      ${visibleTags
        .map((tag) => {
          const count = tag.count ? ` ${tag.count}` : "";
          return `<span>${escapeHtml(tag.name)}${escapeHtml(count)}</span>`;
        })
        .join("")}
    </section>
  `;
}

function renderPlayerSection(players) {
  if (!players.length) return "";

  const firstPlayer = players[0];
  return `
    <section class="player-section" aria-label="授权播放器">
      <div class="player-frame">
        <iframe
          id="authorizedPlayer"
          src="${escapeAttribute(firstPlayer.embedUrl)}"
          title="${escapeAttribute(firstPlayer.label || "授权播放器")}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
        ></iframe>
      </div>
      <div class="player-tabs" id="playerTabs">
        ${players
          .map(
            (player, index) => `
              <button class="${index === 0 ? "active" : ""}" type="button" data-player-index="${index}">
                ${escapeHtml(player.label || `${player.provider || "播放"} ${index + 1}`)}
              </button>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function bindPlayerControls(players) {
  const iframe = document.querySelector("#authorizedPlayer");
  const tabs = document.querySelector("#playerTabs");
  if (!iframe || !tabs || !players.length) return;

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-player-index]");
    if (!button) return;
    const player = players[Number(button.dataset.playerIndex)];
    if (!player) return;
    iframe.src = player.embedUrl;
    iframe.title = player.label || "授权播放器";
    tabs.querySelectorAll("button").forEach((tab) => {
      tab.classList.toggle("active", tab === button);
    });
  });
}

function isAllowedEmbedUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "https:" && allowedEmbedHosts.has(parsedUrl.hostname);
  } catch {
    return false;
  }
}
