// Kazumi-style verification: the site's search page is loaded in a hidden browser
// page and driven by scripts. Image captchas are shown in our own dialog and the
// answer is typed back into the page; button / script captchas run on their own.
// Passing is detected the way Kazumi does it — the captcha element disappears.

const POLL_MS = 500;
const EVAL_TIMEOUT_MS = 5000;
const IMAGE_TIMEOUT_MS = 15000;
const SUBMIT_TIMEOUT_MS = 8000;
const AUTO_TIMEOUT_MS = 30000;

export const CAPTCHA_IMAGE = 1;
export const CAPTCHA_BUTTON = 2;
export const CAPTCHA_SCRIPT = 3;

function bridge() {
  const desktop = window.electronAPI;
  if (typeof desktop?.captchaOpen === "function") {
    return {
      open: (options) => desktop.captchaOpen(options),
      evaluate: (options) => desktop.captchaEval(options),
      close: (options) => desktop.captchaClose(options),
    };
  }
  const plugin = window.Capacitor?.Plugins?.MediaSniffer;
  if (typeof plugin?.captchaOpen === "function") {
    return {
      open: (options) => plugin.captchaOpen(options),
      evaluate: (options) => plugin.captchaEval(options),
      close: (options) => plugin.captchaClose(options),
    };
  }
  return null;
}

export function canRunCaptcha(verify) {
  return Boolean(verify?.captcha && verify.verifyUrl && bridge());
}

function quote(value) {
  return JSON.stringify(String(value || ""));
}

const PRELUDE = `
var __x = function (path) {
  if (!path) return null;
  try { return document.evaluate(path, document, null, 9, null).singleNodeValue; } catch (e) { return null; }
};
if (!window.__kzHooked) {
  window.__kzHooked = 1;
  window.alert = function (message) { window.__kzAlert = String(message == null ? "" : message); };
  window.confirm = function () { return true; };
}
var out = { ready: document.readyState, alert: window.__kzAlert || "" };
window.__kzAlert = "";
`;

function wrap(body) {
  return `(function () {${PRELUDE}${body}\nreturn JSON.stringify(out);})()`;
}

function imageProbe({ image, input }) {
  return wrap(`
var input = __x(${quote(input)});
if (input && !window.__kzFocused) {
  window.__kzFocused = 1;
  try { if (window.jQuery) window.jQuery(input).trigger("focus"); else input.focus(); } catch (e) {}
}
var img = __x(${quote(image)});
out.present = !!img;
if (img && img.complete && img.naturalWidth > 0) {
  try {
    var canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
    out.image = canvas.toDataURL("image/png");
  } catch (e) { out.error = String((e && e.message) || e); }
}`);
}

function submitScript({ input, button }, code) {
  return wrap(`
var field = __x(${quote(input)});
if (field) {
  field.focus();
  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  setter.set.call(field, ${quote(code)});
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}
var submit = __x(${quote(button)});
if (submit) submit.click();
out.filled = !!field;
out.clicked = !!submit;`);
}

function buttonProbe({ button }) {
  return wrap(`
var target = __x(${quote(button)});
out.present = !!target;
if (target && !window.__kzClicked) {
  window.__kzClicked = 1;
  out.clicked = true;
  try { target.click(); } catch (e) {}
}`);
}

function scriptProbe({ script }) {
  return wrap(`
if (!window.__kzRan && document.readyState !== "loading") {
  window.__kzRan = 1;
  window.KazumiCaptcha = {
    log: function () {},
    clicked: function () { window.__kzClicked = 1; },
    done: function () { window.__kzDone = 1; },
    fail: function (message) { window.__kzFail = String(message); }
  };
  try {
    var result = (function () {
${script}
    })();
    if (result === true) window.__kzDone = 1;
  } catch (e) { window.__kzFail = String((e && e.message) || e); }
}
out.done = !!window.__kzDone;
out.fail = window.__kzFail || "";`);
}

// Drives one hidden page. Events go to `on*` callbacks:
//   onImage(dataUrl, { wrong })   a (new) captcha image is ready
//   onWaiting(reason)             no image yet ("timeout") / page reloading
//   onWrong(message)              the site rejected the answer
//   onVerified()                  the captcha disappeared; cookies are saved
//   onFailed(message)             gave up
export function createCaptchaSession(verify, handlers = {}) {
  const api = bridge();
  const config = verify.captcha;
  const type = Number(config.type || CAPTCHA_IMAGE);
  let pageId = null;
  let closed = false;
  let timer = null;
  let busy = false;
  let seen = false;
  let lastImage = "";
  let imageSince = 0;
  let submittedAt = 0;
  let clickedAt = 0;
  let startedAt = 0;
  let waitingReported = false;

  const probe =
    type === CAPTCHA_BUTTON ? buttonProbe(config) : type === CAPTCHA_SCRIPT ? scriptProbe(config) : imageProbe(config);

  async function evaluate(script) {
    if (!pageId) return null;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), EVAL_TIMEOUT_MS));
    try {
      const result = await Promise.race([api.evaluate({ id: pageId, script }), timeout]);
      const raw = result?.value;
      return typeof raw === "string" ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function finish(event, message) {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    const id = pageId;
    pageId = null;
    if (id) await api.close({ id }).catch(() => {});
    if (event === "verified") handlers.onVerified?.();
    else if (event === "failed") handlers.onFailed?.(message);
  }

  function handleImageProbe(state) {
    const now = Date.now();
    if (state.present) {
      seen = true;
      if (state.image && state.image !== lastImage) {
        const wrong = Boolean(submittedAt) && Boolean(lastImage);
        lastImage = state.image;
        submittedAt = 0;
        waitingReported = false;
        handlers.onImage?.(state.image, { wrong, message: wrong ? state.alert : "" });
        return;
      }
      if (submittedAt && state.alert) {
        submittedAt = 0;
        handlers.onWrong?.(state.alert);
        return;
      }
      if (submittedAt && now - submittedAt > SUBMIT_TIMEOUT_MS) {
        submittedAt = 0;
        handlers.onWrong?.("验证没有通过，请换一张重试");
      }
      return;
    }
    if (seen && state.ready !== "loading") {
      finish("verified");
      return;
    }
    if (!lastImage && !waitingReported && now - imageSince > IMAGE_TIMEOUT_MS) {
      waitingReported = true;
      handlers.onWaiting?.("timeout");
    }
  }

  function handleAutoProbe(state) {
    if (type === CAPTCHA_BUTTON) {
      if (state.clicked) clickedAt = Date.now();
      else if (clickedAt && !state.present && state.ready !== "loading") {
        finish("verified");
        return;
      }
    } else {
      if (state.done) {
        finish("verified");
        return;
      }
      if (state.fail) {
        finish("failed", "验证脚本执行失败");
        return;
      }
    }
    if (Date.now() - startedAt > AUTO_TIMEOUT_MS) finish("failed", "验证失败，请稍后重试");
  }

  async function tick() {
    if (busy || closed) return;
    busy = true;
    try {
      const state = await evaluate(probe);
      if (closed || !state) return;
      if (type === CAPTCHA_IMAGE) handleImageProbe(state);
      else handleAutoProbe(state);
    } finally {
      busy = false;
    }
  }

  return {
    type,
    async start() {
      startedAt = Date.now();
      imageSince = startedAt;
      try {
        const opened = await api.open({ url: verify.verifyUrl, userAgent: verify.userAgent || "" });
        pageId = opened?.id || null;
      } catch (error) {
        await finish("failed", error?.message || "无法打开验证页面");
        return;
      }
      if (!pageId) {
        await finish("failed", "无法打开验证页面");
        return;
      }
      if (closed) {
        api.close({ id: pageId }).catch(() => {});
        return;
      }
      timer = setInterval(tick, POLL_MS);
    },
    async submit(code) {
      const result = await evaluate(submitScript(config, code));
      if (!result?.filled || !result?.clicked) throw new Error("页面上找不到验证码输入框");
      submittedAt = Date.now();
    },
    async reload() {
      lastImage = "";
      submittedAt = 0;
      waitingReported = false;
      imageSince = Date.now();
      await evaluate(wrap("setTimeout(function () { location.reload(); }, 0);"));
    },
    cancel() {
      return finish("cancelled");
    },
  };
}
