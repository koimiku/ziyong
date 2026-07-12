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
} from "./episode-sources.js";
import { bindSourcePlayer, renderEpisodeTabs } from "./player.js";
import { initializeMobile, syncMobileWatchState } from "./mobile.js";
import {
  fetchWatchSourceMatches,
  getSourceNamesText,
  loadSourcePlaylists,
} from "./sources.js";
import {
  cleanSynopsis,
  escapeAttribute,
  escapeHtml,
  pickDisplayTitle,
} from "./utils.js";
import { getWatchProgress, recordWatch } from "./watch-history.js";

let activePlayerController = null;

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

  document.querySelector("#watchBackButton")?.addEventListener("click", () => {
    exitWatchMode();
  });

  bindPlayerControls(players);

  const sourceMatches = await fetchWatchSourceMatches(item);
  if (detailPanel.dataset.requestId !== requestId) return;

  const onlineMatches = sourceMatches.filter((entry) => entry.source.kind === "online");
  const torrentMatches = sourceMatches.filter((entry) => entry.source.kind === "torrent");

  const playlists = await loadSourcePlaylists(onlineMatches);
  if (detailPanel.dataset.requestId !== requestId) return;

  const sourceSection = document.querySelector("#sourceSection");
  const watchSupport = document.querySelector("#watchSupport");
  if (!sourceSection || !watchSupport) return;

  const playlistState = { items: playlists };
  const episodeSourceMap = buildEpisodeSourceMap(playlistState.items);
  const rendered = renderWatchPanels(
    onlineMatches,
    playlistState.items,
    episodeSourceMap,
    item,
    title,
    resume
  );
  sourceSection.innerHTML = rendered.player;
  watchSupport.innerHTML = rendered.support;

  const playerApi = bindSourcePlayer(playlistState, episodeSourceMap, {
    itemId: item.id,
    resume,
  });
  activePlayerController = playerApi;

  loadSourcePlaylists(torrentMatches).then((extraPlaylists) => {
    if (detailPanel.dataset.requestId !== requestId || !extraPlaylists.length) return;
    if (activePlayerController !== playerApi) return;
    playlistState.items.push(...extraPlaylists);
    playerApi?.refreshEpisodeMap?.(buildEpisodeSourceMap(playlistState.items));
  });
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
      player: renderSourceFallback(sourceResults, title),
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
          <iframe
            id="sourceEmbed"
            hidden
            title="原站播放器"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowfullscreen
            referrerpolicy="no-referrer-when-downgrade"
          ></iframe>
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
        <div class="episode-tabs entry-episode-tabs" id="episodeTabs">
          ${renderEpisodeTabs(
            episodeSourceMap.map((entry) => ({ label: entry.label, nid: entry.nid })),
            episodeIndex
          )}
        </div>
      </section>

      <section class="media-selector entry-panel" aria-label="同集多源">
        <div class="support-section-title">
          <strong>片源线路</strong>
          <a class="text-link" id="sourceOpenLink" href="${escapeAttribute(
            initialEpisode.pageUrl
          )}" target="_blank" rel="noreferrer">原站打开</a>
        </div>
        <p class="entry-panel-tip">同一集可在多个站点间切换，优先使用你选中的线路。</p>
        <div class="episode-source-chips" id="episodeSourceChips">
          ${renderEpisodeSourceChips(episodeEntry, sourceIndex)}
        </div>
      </section>

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

function renderSourceFallback(sourceResults, title) {
  const blocks = sourceResults
    .map(({ source, matches }) => {
      const items = matches.length
        ? matches
            .map(
              (match) => `
                <a class="watch-link primary" href="${escapeAttribute(match.url)}" target="_blank" rel="noreferrer">
                  <span>
                    <strong>${escapeHtml(source.name)}</strong>
                    <em>${escapeHtml(match.name)}</em>
                  </span>
                  <span aria-hidden="true">↗</span>
                </a>
              `
            )
            .join("")
        : `
          <a class="watch-link primary" href="${escapeAttribute(source.searchUrl(title))}" target="_blank" rel="noreferrer">
            <span>
              <strong>${escapeHtml(source.name)}</strong>
              <em>打开站内搜索</em>
            </span>
            <span aria-hidden="true">↗</span>
          </a>
        `;

      return `
        <div class="source-group">
          <div class="source-group-title">${escapeHtml(source.name)}</div>
          <div class="link-list source-links">${items}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="source-header">
      <strong>在线观看</strong>
      <span>暂时无法内嵌播放，可跳转到站点观看。</span>
    </div>
    ${blocks}
  `;
}

function renderAlternateMatches(sourceResults) {
  const extras = sourceResults.flatMap(({ source, matches }) =>
    matches.slice(1).map((match) => ({ source, match }))
  );

  if (!extras.length) return "";

  return `
    <div class="source-group">
      <div class="source-group-title">其他匹配</div>
      <div class="link-list source-links">
        ${extras
          .map(
            ({ source, match }) => `
              <a class="watch-link" href="${escapeAttribute(match.url)}" target="_blank" rel="noreferrer">
                <span>
                  <strong>${escapeHtml(source.name)}</strong>
                  <em>${escapeHtml(match.name)}</em>
                </span>
                <span aria-hidden="true">↗</span>
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
