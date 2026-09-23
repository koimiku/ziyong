const SCROLL_STEP_RATIO = 0.82;
const rowNavHandlers = new WeakMap();

export function initializeMediaRows() {
  document.querySelectorAll(".media-row").forEach(setupMediaRow);
}

function setupMediaRow(row) {
  const track = row.querySelector(".media-row-track");
  if (!track || row.querySelector(".media-row-scroller")) return;

  const scroller = document.createElement("div");
  scroller.className = "media-row-scroller";

  const prev = createNavButton("prev", "向左滚动");
  const next = createNavButton("next", "向右滚动");

  track.replaceWith(scroller);
  scroller.append(prev, track, next);
  track.tabIndex = 0;
  const scrollPage = (direction) => track.scrollBy({
    left: direction * track.clientWidth * SCROLL_STEP_RATIO,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
  track.addEventListener("keydown", (event) => {
    if (event.target !== track || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    scrollPage(event.key === "ArrowLeft" ? -1 : 1);
  });

  let navFrame = 0;
  const updateNav = () => {
    if (navFrame) return;
    navFrame = requestAnimationFrame(() => {
      navFrame = 0;
      const maxScroll = track.scrollWidth - track.clientWidth;
      const hasOverflow = maxScroll > 4;
      prev.disabled = !hasOverflow || track.scrollLeft <= 4;
      next.disabled = !hasOverflow || track.scrollLeft >= maxScroll - 4;
      scroller.classList.toggle("has-overflow", hasOverflow);
    });
  };

  rowNavHandlers.set(track, updateNav);

  prev.addEventListener("click", () => {
    scrollPage(-1);
  });

  next.addEventListener("click", () => {
    scrollPage(1);
  });

  track.addEventListener("scroll", updateNav, { passive: true });

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(updateNav);
    observer.observe(track);
  }

  updateNav();
}

function createNavButton(direction, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `media-row-nav media-row-nav--${direction}`;
  button.setAttribute("aria-label", label);
  button.innerHTML =
    direction === "prev"
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 5.3a1 1 0 0 1 0 1.4L10.41 11l4.3 4.3a1 1 0 0 1-1.42 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.41 0Z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.3 5.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4-1.4L13.59 11l-4.3-4.3a1 1 0 0 1 0-1.4Z"/></svg>';
  return button;
}

export function refreshMediaRows() {
  document.querySelectorAll(".media-row-track").forEach((track) => {
    rowNavHandlers.get(track)?.();
  });
}
