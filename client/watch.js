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
import { bindSourcePlayer, hasTextEpisodes, renderEpisodeTabs } from "./player.js";
import { initializeMobile, syncMobileWatchState } from "./mobile.js";
import {
  getSourceNamesText,
  loadSourcePlaylist,
  prepareWatchSearch,
  isVerifyError,
  searchSourceForItem,
} from "./sources.js";
import { createSourceSheet } from "./source-sheet.js";
import { canVerifySite, verifySite } from "./site-verify.js";
import {
  cleanSynopsis,
  escapeAttribute,
  escapeHtml,
  pickDisplayTitle,
} from "./utils.js";
import { getWatchProgress, recordWatch } from "./watch-history.js";

const SHEET_MIN_SCORE = 40;
const SHEET_RESULT_LIMIT = 12;

let activePlayerController = null;
let lastCardOrigin = null;
let returnPoster = null;
let exitingDetail = false;

document.addEventListener(
  "click",
  (event) => {
    const card = event.target.closest?.(".anime-card, .hero-card, .calendar-card");
    if (!card) return;
    const poster = card.querySelector("img") || card;
    lastCardOrigin = {
      rect: poster.getBoundingClientRect(),
      time: performance.now(),
      poster,
      section: card.closest("section, .media-row")?.className,
    };
  },
  true
);

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function createCoverGhost(cover, rect) {
  const ghost = cover.cloneNode();
  ghost.removeAttribute("id");
  ghost.className = "entry-cover-ghost";
  Object.assign(ghost.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  document.body.append(ghost);
  return ghost;
}

function playCardExpansion() {
  const origin = lastCardOrigin;
  lastCardOrigin = null;
  if (!origin || performance.now() - origin.time > 1500) return;
  returnPoster = origin;
  if (prefersReducedMotion()) return;
  const page = detailPanel.querySelector(".entry-page");
  const cover = detailPanel.querySelector(".entry-cover");
  if (!page || !cover || typeof cover.animate !== "function") return;
  const target = cover.getBoundingClientRect();
  const from = origin.rect;
  if (!target.width || !target.height || !from.width || !from.height) return;

  const ghost = createCoverGhost(cover, target);
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

// Reverse of the card expansion: the page sinks away while its cover flies back
// into the card it was opened from.
export function exitWatchMode() {
  if (exitingDetail) return;
  const page = detailPanel.querySelector(".entry-page");
  if (!page || prefersReducedMotion() || typeof page.animate !== "function") {
    finishExitWatchMode();
    return;
  }
  exitingDetail = true;
  stopActivePlayback();
  document.body.classList.remove("source-sheet-open");

  const cover = page.classList.contains("is-playing") ? null : page.querySelector(".entry-cover");
  const coverRect = cover?.getBoundingClientRect();
  const ghost = coverRect?.width ? createCoverGhost(cover, coverRect) : null;
  if (ghost) cover.style.visibility = "hidden";

  const fade = page.animate(
    [
      { opacity: 1, transform: "none" },
      { opacity: 0, transform: "translateY(28px) scale(.985)" },
    ],
    { duration: 220, easing: "cubic-bezier(.3, 0, .8, .15)", fill: "forwards" }
  );
  fade.finished
    .catch(() => {})
    .then(() => {
      exitingDetail = false;
      finishExitWatchMode();
      document.querySelector(".main-stage")?.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 200,
        easing: "ease-out",
      });
      if (ghost) flyCoverBack(ghost, coverRect);
    });
}

function findReturnPoster(origin) {
  if (!origin) return null;
  if (origin.poster.isConnected) return origin.poster;
  const src = origin.poster.getAttribute?.("src");
  if (!src) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const img of document.querySelectorAll(".main-stage img")) {
    if (img.getAttribute("src") !== src) continue;
    const rect = img.getBoundingClientRect();
    if (!rect.width) continue;
    const sameSection = img.closest("section, .media-row")?.className === origin.section;
    const distance =
      Math.hypot(rect.left - origin.rect.left, rect.top - origin.rect.top) + (sameSection ? 0 : 1e5);
    if (distance < bestDistance) {
      best = img;
      bestDistance = distance;
    }
  }
  return best;
}

function flyCoverBack(ghost, from) {
  const poster = findReturnPoster(returnPoster);
  returnPoster = null;
  const target = poster ? poster.getBoundingClientRect() : null;
  const margin = target ? target.height / 4 : 0;
  const visible =
    target &&
    target.width > 0 &&
    target.top >= -margin &&
    target.bottom <= window.innerHeight + margin;
  if (!visible) {
    const out = ghost.animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "scale(.9)" },
      ],
      { duration: 200, easing: "ease-in", fill: "forwards" }
    );
    out.finished.catch(() => {}).then(() => ghost.remove());
    return;
  }
  poster.style.visibility = "hidden";
  const flight = ghost.animate(
    [
      { transform: "none", borderRadius: "14px" },
      {
        transform: `translate(${target.left - from.left}px, ${target.top - from.top}px) scale(${
          target.width / from.width
        }, ${target.height / from.height})`,
        borderRadius: "12px",
      },
    ],
    { duration: 420, easing: "cubic-bezier(.2, 0, 0, 1)", fill: "forwards" }
  );
  flight.finished
    .catch(() => {})
    .then(() => {
      poster.style.visibility = "";
      ghost.remove();
    });
}

function finishExitWatchMode() {
  stopActivePlayback();
  document.body.classList.remove("source-sheet-open");
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
  exitingDetail = false;
  returnPoster = null;
  stopActivePlayback();
  document.body.classList.remove("source-sheet-open");
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

  const page = detailPanel.querySelector(".entry-page");
  const { sources, queries, preset } = await prepareWatchSearch(item);
  if (detailPanel.dataset.requestId !== requestId || !page?.isConnected) return;

  startWatchFlow({ page, item, requestId, sources, queries, preset });
}

// Kazumi flow: every source searches in the background, the user picks a result
// in the source sheet, and the player page then uses only that source.
function startWatchFlow({ page, item, requestId, sources, queries, preset }) {
  const isCurrent = () => detailPanel.dataset.requestId === requestId && page.isConnected;
  const startHint = page.querySelector("#startWatchHint");
  let currentSourceId = null;
  let openToken = 0;

  const keywords = [
    ...new Set([...queries, ...(item.aliases || [])].map((value) => String(value).trim()).filter(Boolean)),
  ].slice(0, 6);
  const sheet = createSourceSheet({
    container: page,
    keywords,
    onSelect: (source, match) => openSource(source, match),
    onRetry: (source) => runSource(source, queries),
    onSearch: (source, keyword) => runSource(source, [keyword], { minScore: 0 }),
    onVerify: async (source, verify) => {
      if (!(await runVerification(verify))) return;
      runSource(source, queries);
    },
  });
  let pendingVerify = null;

  async function runVerification(verify) {
    try {
      return (await verifySite(verify)) && isCurrent();
    } catch (error) {
      console.warn("site verify", error);
      return false;
    }
  }
  sheet.setSources(sources);
  updateStartHint();

  function updateStartHint() {
    if (!startHint) return;
    if (!sources.length) {
      startHint.textContent = "还没有可用的片源，请先到「片源」页安装规则。";
      return;
    }
    const { total, done, ready, verify } = sheet.stats();
    const verifyNote = verify ? `，${verify} 个需要网页验证` : "";
    if (done < total) {
      startHint.textContent = `正在检索片源 ${done}/${total}${ready ? `，${ready} 个已找到` : ""}${verifyNote}`;
    } else {
      startHint.textContent = ready
        ? `${ready} 个片源找到了这部番${verifyNote}`
        : verify
          ? `${verify} 个片源需要网页验证，打开片源面板去验证`
          : "暂时没有片源找到这部番，可以在片源面板里换个名字检索";
    }
  }

  async function runSource(source, sourceQueries, options = {}) {
    if (!isCurrent()) return;
    sheet.update(source.id, { state: "pending", error: "" });
    updateStartHint();
    try {
      const presetMatches = sourceQueries === queries ? preset.get(source.id) : null;
      const matches =
        presetMatches ||
        (await searchSourceForItem(source, sourceQueries, {
          minScore: SHEET_MIN_SCORE,
          limit: SHEET_RESULT_LIMIT,
          ...options,
        }));
      if (!isCurrent()) return;
      sheet.update(source.id, { state: matches.length ? "ready" : "empty", matches });
    } catch (error) {
      console.warn(source.id, error);
      if (!isCurrent()) return;
      if (isVerifyError(error)) {
        sheet.update(source.id, {
          state: "verify",
          matches: [],
          verify: error.verify,
        });
      } else {
        sheet.update(source.id, { state: "error", matches: [], error: describeSourceError(error) });
      }
    }
    updateStartHint();
  }

  async function openSource(source, match) {
    sheet.close();
    stopActivePlayback();
    const token = ++openToken;
    currentSourceId = source.id;
    page.classList.add("is-playing");
    window.scrollTo?.({ top: 0 });

    const sourceSection = page.querySelector("#sourceSection");
    const support = page.querySelector("#watchSupport");
    sourceSection.innerHTML = renderPlayerPlaceholder(`正在加载 ${source.name} 的播放列表…`);
    support.innerHTML = renderCurrentSource(source, match);

    let playlist = null;
    try {
      playlist = await loadSourcePlaylist({ source, matches: [match] });
    } catch (error) {
      if (token !== openToken || !isCurrent()) return;
      if (!isVerifyError(error)) throw error;
      const verifiable = canVerifySite();
      pendingVerify = {
        verify: error.verify,
        retry: () => openSource(source, match),
      };
      sourceSection.innerHTML = renderPlayerPlaceholder(
        verifiable
          ? `${source.name} 要求先完成网页验证，验证后会自动重新加载`
          : `${source.name} 要求先完成网页验证，请在电脑版或安卓 App 中验证`,
        true,
        verifiable
      );
      return;
    }
    if (token !== openToken || !isCurrent()) return;
    if (!playlist) {
      sourceSection.innerHTML = renderPlayerPlaceholder(`${source.name} 没有可播放的线路，请更换片源`, true);
      return;
    }

    const items = [playlist];
    const episodeSourceMap = buildEpisodeSourceMap(items);
    const resume = getWatchProgress(item.id);
    const rendered = renderWatchPanels(playlist, episodeSourceMap, resume);
    sourceSection.innerHTML = rendered.player;
    support.innerHTML = renderCurrentSource(source, match) + rendered.support;
    activePlayerController = bindSourcePlayer({ items }, episodeSourceMap, {
      itemId: item.id,
      resume,
      singleSource: true,
      autoplay: true,
    });
  }

  async function backToDetail() {
    const token = ++openToken;
    stopActivePlayback();
    const body = page.querySelector(".entry-body");
    if (body && !prefersReducedMotion() && typeof body.animate === "function") {
      await body
        .animate(
          [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: "scale(.97)" },
          ],
          { duration: 180, easing: "cubic-bezier(.3, 0, .8, .15)" }
        )
        .finished.catch(() => {});
      if (token !== openToken || !isCurrent()) return;
    }
    page.classList.remove("is-playing");
    page.querySelector("#sourceSection").innerHTML = "";
    page.querySelector("#watchSupport").innerHTML = "";
    const label = page.querySelector("#startWatchLabel");
    const resume = getWatchProgress(item.id);
    if (label) label.textContent = startWatchLabel(resume);
    if (!prefersReducedMotion()) {
      page.querySelector(".entry-hero")?.animate(
        [
          { opacity: 0, transform: "translateY(-12px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 280, easing: "cubic-bezier(.05, .7, .1, 1)" }
      );
      body?.animate(
        [
          { opacity: 0, transform: "translateY(14px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 300, easing: "cubic-bezier(.05, .7, .1, 1)" }
      );
    }
  }

  page.addEventListener("click", (event) => {
    if (event.target.closest("#startWatchButton")) {
      sheet.open(getWatchProgress(item.id)?.sourceId);
      return;
    }
    if (event.target.closest("[data-change-source]")) {
      sheet.open(currentSourceId);
      return;
    }
    if (event.target.closest("[data-site-verify]")) {
      handleSiteVerify();
      return;
    }
    if (event.target.closest("#playerBackButton")) backToDetail();
  });

  async function handleSiteVerify() {
    const frame = page.querySelector("#playerFrame");
    if (frame?.classList.contains("needs-verify")) {
      let verify = {};
      try {
        verify = JSON.parse(frame.dataset.verify || "{}");
      } catch {
        verify = {};
      }
      if (await runVerification(verify)) page.querySelector("#playStartButton")?.click();
      return;
    }
    const job = pendingVerify;
    if (!job) return;
    if (await runVerification(job.verify)) job.retry();
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

function startWatchLabel(resume) {
  return resume?.episodeLabel ? `继续观看 ${resume.episodeLabel}` : "开始观看";
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
        <section class="entry-overview" aria-label="开始观看">
          <div class="start-watch">
            <button class="start-watch-button" id="startWatchButton" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
              <span id="startWatchLabel">${escapeHtml(startWatchLabel(resume))}</span>
            </button>
            <p class="start-watch-hint" id="startWatchHint">正在准备片源…</p>
          </div>
          ${renderPlayerSection(players)}
          <section class="watch-summary entry-panel">
            <div class="support-section-title"><strong>简介</strong></div>
            <p class="summary">${escapeHtml(cleanSynopsis(item.synopsis))}</p>
            ${renderTags(item.tags)}
            ${renderBangumiLink(item)}
          </section>
        </section>
        <section class="entry-player-column" aria-label="播放器">
          <button class="player-back-button" id="playerBackButton" type="button" aria-label="返回详情">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <div class="watch-player-slot" id="sourceSection"></div>
        </section>
        <aside class="entry-sidebar" id="watchSupport" aria-label="选集与线路"></aside>
      </div>
    </div>
  `;
}

function renderPlayerPlaceholder(message, failed = false, verify = false) {
  return `
    <div class="player-section source-player">
      <div class="player-frame player-placeholder ${failed ? "is-failed" : "is-loading"}">
        ${failed ? "" : `<i class="source-sheet-spinner" aria-hidden="true"></i>`}
        <p>${escapeHtml(message)}</p>
        ${
          failed
            ? `<div class="player-placeholder-actions">
                ${verify ? `<button class="small-button" type="button" data-site-verify>去验证</button>` : ""}
                <button class="${verify ? "ghost-button" : "small-button"}" type="button" data-change-source>更换片源</button>
              </div>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderCurrentSource(source, match) {
  return `
    <section class="entry-panel current-source" aria-label="当前片源">
      <div class="current-source-text">
        <span>当前片源</span>
        <strong>${escapeHtml(source.name)}</strong>
        <em>${escapeHtml(match.name)}</em>
      </div>
      <button class="ghost-button" type="button" data-change-source>更换片源</button>
    </section>
  `;
}

function getAuthorizedPlayers(bangumiId) {
  return authorizedPlayers
    .filter((player) => player.bangumiId === bangumiId || player.subjectId === bangumiId)
    .filter((player) => isAllowedEmbedUrl(player.embedUrl));
}

function renderWatchPanels(playlist, episodeSourceMap, resume) {
  const episodeIndex = findEpisodeIndex(episodeSourceMap, resume);
  const episodeEntry = episodeSourceMap[episodeIndex] || episodeSourceMap[0];
  const sourceIndex = findSourceIndex(episodeEntry, resume);
  const initialSource = episodeEntry?.sources?.[sourceIndex] || episodeEntry?.sources?.[0];
  const initialLine = playlist.lines[initialSource?.lineIndex ?? 0] || playlist.lines[0];
  const initialEpisode = initialLine.episodes[initialSource?.episodeIndex ?? 0] || initialLine.episodes[0];

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
            title="${escapeAttribute(`${playlist.sourceName} ${initialEpisode.label}`)}"
          ></video>
          <div class="player-status" id="sourcePlayerStatus" hidden></div>
          <button class="play-start-button" id="playStartButton" type="button">
            <span class="play-start-icon" aria-hidden="true">▶</span>
            <strong>${resume?.position > 0 ? "继续播放" : "立即播放"}</strong>
            <em id="playStartHint">${escapeHtml(initialEpisode.label)} · ${escapeHtml(playlist.sourceName)}</em>
          </button>
          <div class="player-corner-actions">
            <button class="player-switch-source player-verify" type="button" data-site-verify>去验证</button>
            <button class="player-switch-source" type="button" data-change-source>更换片源</button>
          </div>
        </div>
        <div class="player-meta" id="sourcePlayerMeta">
          ${escapeHtml(playlist.matchName)} · ${escapeHtml(initialLine.name)} · ${escapeHtml(initialEpisode.label)}
        </div>
      </div>
    `,
    support: `
      <section class="episode-selector entry-panel" aria-label="剧集列表">
        <div class="support-section-title">
          <strong>选集</strong>
          <span id="episodeCountLabel">${episodeSourceMap.length} 集</span>
          <button class="episode-expand" type="button" data-episode-expand aria-expanded="false">全部</button>
        </div>
        <div
          class="episode-grid${hasTextEpisodes(episodeSourceMap) ? " is-text" : ""}"
          id="episodeTabs"
          role="listbox"
          aria-label="选集"
        >
          ${renderEpisodeTabs(
            episodeSourceMap.map((entry) => ({ label: entry.label, nid: entry.nid })),
            episodeIndex
          )}
        </div>
      </section>

      <section class="media-selector entry-panel" aria-label="播放线路">
        <div class="support-section-title">
          <strong>播放线路</strong>
        </div>
        <div class="option-dropdown" id="sourceDropdown">
          <button class="option-dropdown-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span id="sourceDropdownValue">${escapeHtml(sourceOptionLabel(initialSource || {}) || "选择线路")}</span>
            <span class="option-dropdown-caret" aria-hidden="true"></span>
          </button>
          <div class="option-dropdown-menu" id="episodeSourceChips" role="listbox" hidden>
            ${renderEpisodeSourceChips(episodeEntry, sourceIndex)}
          </div>
        </div>
      </section>
    `,
  };
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
