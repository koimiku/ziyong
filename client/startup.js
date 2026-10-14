(() => {
  const key = "anime-startup";
  const validImage = value => typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(value) && value.length < 1500000;
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "{}");
      return { enabled: value?.enabled === true, image: validImage(value?.image) ? value.image : "" };
    } catch { return { enabled: false, image: "" }; }
  }
  function show(config) {
    if (!config.enabled) return;
    document.querySelector(".startup-screen")?.remove();
    const screen = document.createElement("div");
    screen.className = "startup-screen";
    screen.setAttribute("role", "dialog");
    screen.setAttribute("aria-label", "开屏");
    const content = document.createElement(config.image ? "img" : "strong");
    if (config.image) { content.src = config.image; content.alt = "自定义开屏图片"; }
    else content.textContent = "anime";
    const skip = document.createElement("button");
    skip.type = "button";
    skip.textContent = "跳过";
    screen.append(content, skip);
    document.body.append(screen);
    let timer;
    const close = () => { clearTimeout(timer); screen.remove(); };
    skip.addEventListener("click", close);
    content.addEventListener("error", close);
    timer = setTimeout(close, 1200);
  }
  show(read());
  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.querySelector("#startupEnabled");
    const file = document.querySelector("#startupImage");
    const preview = document.querySelector("#startupPreview");
    const status = document.querySelector("#startupStatus");
    const choose = document.querySelector("#startupChoose");
    let config = read();
    const render = () => {
      toggle.checked = config.enabled;
      preview.hidden = !config.image;
      if (config.image) preview.src = config.image;
      else preview.removeAttribute("src");
    };
    const save = next => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
        config = next;
        render();
        status.textContent = config.enabled ? "已保存，下次打开时显示开屏。" : "已关闭，下次打开直接进入首页。";
      } catch { render(); status.textContent = "保存失败，存储空间可能不足，请尝试更小的图片。"; }
    };
    toggle.addEventListener("change", () => save({ ...config, enabled: toggle.checked }));
    choose.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const selected = file.files?.[0];
      file.value = "";
      if (!selected) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(selected.type) || selected.size > 10 * 1024 * 1024) {
        status.textContent = "请选择 10 MB 以内的 PNG、JPG 或 WebP 图片。"; return;
      }
      choose.disabled = true;
      let url;
      try {
        url = URL.createObjectURL(selected);
        const img = new Image();
        img.src = url;
        await img.decode();
        const scale = Math.min(1, 1080 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#f3f5f8";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL("image/jpeg", 0.82);
        if (!validImage(data)) throw new Error("Image too large");
        save({ enabled: true, image: data });
      } catch { status.textContent = "图片读取失败，请尝试另一张图片。"; }
      finally { if (url) URL.revokeObjectURL(url); choose.disabled = false; }
    });
    document.querySelector("#startupReset").addEventListener("click", () => save({ ...config, image: "" }));
    document.querySelector("#startupShow").addEventListener("click", () => show({ ...config, enabled: true }));
    render();
  });
})();