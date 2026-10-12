function closeOptionDropdowns() {
  document.querySelectorAll(".option-dropdown.is-open").forEach((root) => {
    root.classList.remove("is-open");
    const menu = root.querySelector(".option-dropdown-menu");
    const trigger = root.querySelector(".option-dropdown-trigger");
    if (menu) menu.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
  });
}

function bindDocumentClose() {
  if (document.documentElement.dataset.optionDropdownBound === "1") return;
  document.documentElement.dataset.optionDropdownBound = "1";
  document.addEventListener("click", () => closeOptionDropdowns());
}

function enhanceSelect(select) {
  if (select.dataset.compactSelect === "1") return;
  select.dataset.compactSelect = "1";
  select.classList.add("native-select-proxy");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  if (select.id) {
    document.querySelectorAll(`label[for="${CSS.escape(select.id)}"]`).forEach((label) => {
      label.removeAttribute("for");
    });
  }

  const dropdown = document.createElement("div");
  dropdown.className = "option-dropdown compact-select";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "option-dropdown-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  if (select.getAttribute("aria-label")) {
    trigger.setAttribute("aria-label", select.getAttribute("aria-label"));
  }

  const label = document.createElement("span");
  const caret = document.createElement("span");
  caret.className = "option-dropdown-caret";
  caret.setAttribute("aria-hidden", "true");
  trigger.append(label, caret);

  const menu = document.createElement("div");
  menu.className = "option-dropdown-menu";
  menu.hidden = true;
  menu.setAttribute("role", "listbox");

  function render() {
    const selected = select.selectedOptions?.[0];
    label.textContent = selected?.textContent?.trim() || "";
    menu.replaceChildren(
      ...[...select.options].map((option) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "option-dropdown-item";
        item.setAttribute("role", "option");
        const active = option.value === select.value;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
        item.textContent = option.textContent.trim();
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          if (select.value !== option.value) {
            select.value = option.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
          closeOptionDropdowns();
        });
        return item;
      })
    );
  }

  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  if (valueDescriptor?.get && valueDescriptor?.set) {
    try {
      Object.defineProperty(select, "value", {
        configurable: true,
        get() {
          return valueDescriptor.get.call(this);
        },
        set(next) {
          valueDescriptor.set.call(this, next);
          render();
        },
      });
    } catch {
      // Keep the visible label in sync through the change listener below.
    }
  }

  select.addEventListener("change", render);
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menu.hidden;
    closeOptionDropdowns();
    if (!willOpen) return;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    dropdown.classList.add("is-open");
  });

  select.insertAdjacentElement("afterend", dropdown);
  dropdown.append(trigger, menu);
  render();
}

export function enhanceNativeSelects(root = document) {
  bindDocumentClose();
  root.querySelectorAll("select").forEach(enhanceSelect);
}
