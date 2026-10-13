import { CAPTCHA_IMAGE, createCaptchaSession } from "./captcha-flow.js";

const SUCCESS_CLOSE_MS = 1600;

const SHIELD_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4-6.3 6.3Z"/></svg>';
const REFRESH_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"/></svg>';
const BROKEN_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 5v6.59l-3-3.01-4 4.01-4-4-4 4-3-3.01V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Zm-3 6.42 3 3.01V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6.58l3 2.99 4-4 4 4 4-3.99Z"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z"/></svg>';

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function spinner(size = 40) {
  return `<span class="kz-spinner" style="--size:${size}px" role="progressbar"></span>`;
}

// Resolves true once the site is verified, false when the user backs out.
export function runCaptchaDialog(verify) {
  return new Promise((resolve) => {
    const sourceName = verify.sourceName || "片源";
    const scrim = document.createElement("div");
    scrim.className = "kz-dialog-scrim";
    scrim.innerHTML = `
      <section class="kz-dialog" role="dialog" aria-modal="true" aria-labelledby="kzDialogTitle">
        <div class="kz-dialog-source">${SHIELD_ICON}<span>${escapeHtml(sourceName)}</span></div>
        <h2 class="kz-dialog-title" id="kzDialogTitle"></h2>
        <p class="kz-dialog-desc"></p>
        <div class="kz-dialog-body"></div>
        <div class="kz-dialog-actions"></div>
      </section>`;
    const dialog = scrim.querySelector(".kz-dialog");
    const title = scrim.querySelector(".kz-dialog-title");
    const desc = scrim.querySelector(".kz-dialog-desc");
    const body = scrim.querySelector(".kz-dialog-body");
    const actions = scrim.querySelector(".kz-dialog-actions");

    let settled = false;
    let submitting = false;
    let hasImage = false;
    let input = null;
    let currentImage = "";

    const session = createCaptchaSession(verify, {
      onImage(dataUrl, { wrong, message }) {
        submitting = false;
        hasImage = true;
        renderImage(dataUrl, wrong ? message || "验证码不正确，请重新输入" : "");
      },
      onWaiting() {
        if (!hasImage) renderImageError("暂时没有获取到验证码");
      },
      onWrong(message) {
        submitting = false;
        if (currentImage) renderImage(currentImage, message || "验证码不正确，请重新输入");
        else reload();
      },
      onVerified() {
        renderSuccess();
      },
      onFailed(message) {
        renderFailure(message);
      },
    });

    function close(result) {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      scrim.classList.add("is-closing");
      setTimeout(() => scrim.remove(), 160);
      resolve(result);
    }

    function cancel() {
      if (settled) return;
      session.cancel();
      close(false);
    }

    function onKeydown(event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        cancel();
      }
    }

    function setHeader(text, description) {
      title.textContent = text;
      desc.textContent = description;
    }

    function setActions(html) {
      actions.innerHTML = html;
      actions.hidden = !html;
    }

    function backButton() {
      return '<button type="button" class="kz-text-button" data-kz-cancel>返回来源</button>';
    }

    function renderImageShell() {
      setHeader("输入验证码", "输入下图中的字符，继续检索此来源。");
      body.innerHTML = `
        <div class="kz-captcha-box">${spinner()}<span>正在加载验证码…</span></div>
        <div class="kz-captcha-tools" hidden>
          <button type="button" class="kz-text-button" data-kz-reload>${REFRESH_ICON}换一张</button>
        </div>
        <label class="kz-field" hidden>
          <span class="kz-field-label">验证码</span>
          <input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" />
        </label>
        <p class="kz-field-error" hidden></p>`;
      input = body.querySelector("input");
      input.addEventListener("input", () => showInputError(""));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      });
      setActions(
        `${backButton()}<button type="button" class="kz-filled-button" data-kz-submit disabled>验证</button>`
      );
    }

    function renderImage(dataUrl, error) {
      const box = body.querySelector(".kz-captcha-box");
      if (!box) return;
      currentImage = dataUrl;
      box.innerHTML = `<img class="kz-captcha-image" alt="验证码图片" src="${escapeHtml(dataUrl)}" />`;
      body.querySelector(".kz-captcha-tools").hidden = false;
      body.querySelector(".kz-field").hidden = false;
      setSubmitting(false);
      input.value = "";
      showInputError(error);
      input.focus();
    }

    function renderImageLoading(text = "正在加载验证码…") {
      const box = body.querySelector(".kz-captcha-box");
      if (box) box.innerHTML = `${spinner()}<span>${escapeHtml(text)}</span>`;
    }

    function renderImageError(text) {
      const box = body.querySelector(".kz-captcha-box");
      if (!box) return;
      box.innerHTML = `
        <span class="kz-captcha-error">${BROKEN_ICON}</span>
        <span>${escapeHtml(text)}</span>
        <button type="button" class="kz-text-button" data-kz-reload>${REFRESH_ICON}重新加载</button>`;
    }

    function setSubmitting(value) {
      const button = actions.querySelector("[data-kz-submit]");
      if (button) {
        button.disabled = value || !hasImage;
        button.textContent = value ? "验证中…" : "验证";
      }
      if (input) input.disabled = value;
      const tools = body.querySelector("[data-kz-reload]");
      if (tools) tools.disabled = value;
    }

    function showInputError(message) {
      const error = body.querySelector(".kz-field-error");
      if (!error) return;
      error.textContent = message || "";
      error.hidden = !message;
      body.querySelector(".kz-field")?.classList.toggle("has-error", Boolean(message));
    }

    async function submit() {
      if (submitting || !hasImage || !input) return;
      const code = input.value.trim();
      if (!code) {
        showInputError("请输入图片中的字符");
        input.focus();
        return;
      }
      submitting = true;
      setSubmitting(true);
      renderImageLoading("正在等待验证结果…");
      try {
        await session.submit(code);
      } catch {
        submitting = false;
        setSubmitting(false);
        reload();
        showInputError("未能提交，请重试");
      }
    }

    function reload() {
      if (submitting) return;
      hasImage = false;
      currentImage = "";
      setSubmitting(false);
      showInputError("");
      renderImageLoading();
      session.reload();
    }

    function renderAutomated() {
      setHeader("正在验证", "正在等待网站响应，通过后会自动继续检索。");
      body.innerHTML = `<div class="kz-auto-box">${spinner(72)}</div>`;
      setActions(backButton());
    }

    function renderSuccess() {
      if (settled) return;
      setHeader("验证通过", "即将自动继续检索。");
      body.innerHTML = `<div class="kz-success-box"><span class="kz-success-badge">${CHECK_ICON}</span></div>`;
      setActions("");
      setTimeout(() => close(true), SUCCESS_CLOSE_MS);
    }

    function renderFailure(message) {
      if (settled) return;
      setHeader("验证失败", message || "验证失败，请稍后重试");
      body.innerHTML = "";
      setActions(backButton());
    }

    scrim.addEventListener("click", (event) => {
      if (event.target === scrim) {
        cancel();
        return;
      }
      if (event.target.closest("[data-kz-cancel]")) cancel();
      else if (event.target.closest("[data-kz-submit]")) submit();
      else if (event.target.closest("[data-kz-reload]")) reload();
    });
    document.addEventListener("keydown", onKeydown, true);

    if (session.type === CAPTCHA_IMAGE) renderImageShell();
    else renderAutomated();
    document.body.append(scrim);
    requestAnimationFrame(() => scrim.classList.add("is-open"));
    dialog.focus?.();
    session.start();
  });
}
