function setupCustomSelect(selectEl) {
  if (!selectEl || selectEl.dataset.cselectReady === "1") return;
  selectEl.dataset.cselectReady = "1";

  selectEl.classList.add("cselect-native");

  const wrapper = document.createElement("div");
  wrapper.className = "cselect";
  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(selectEl);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cselect-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const valueEl = document.createElement("span");
  valueEl.className = "cselect-value";

  const caret = document.createElement("span");
  caret.className = "cselect-caret";

  trigger.appendChild(valueEl);
  trigger.appendChild(caret);

  const menu = document.createElement("div");
  menu.className = "cselect-menu";
  menu.setAttribute("role", "listbox");

  wrapper.appendChild(trigger);
  document.body.appendChild(menu);

  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect();
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    const gap = 8;
    const minMenuHeight = 140;
    const preferredMaxHeight = 260;

    const spaceBelow = Math.max(0, viewportH - rect.bottom - gap);
    const spaceAbove = Math.max(0, rect.top - gap);
    const openUp = spaceBelow < minMenuHeight && spaceAbove > spaceBelow;
    const usableSpace = openUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(minMenuHeight, Math.min(preferredMaxHeight, usableSpace - 6));

    menu.style.minWidth = `${Math.round(rect.width)}px`;
    menu.style.left = `${Math.round(rect.left)}px`;
    menu.style.top = openUp
      ? `${Math.round(rect.top - gap)}px`
      : `${Math.round(rect.bottom + gap)}px`;
    menu.style.transform = openUp ? "translateY(-100%)" : "none";
    menu.style.maxHeight = `${Math.round(maxHeight)}px`;
  };

  const handleViewportChange = () => {
    if (!wrapper.classList.contains("open")) return;
    positionMenu();
  };

  const close = () => {
    wrapper.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    menu.classList.remove("open");
  };

  const open = () => {
    wrapper.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    positionMenu();
    menu.classList.add("open");
  };

  const syncLabel = () => {
    const option = selectEl.options[selectEl.selectedIndex];
    valueEl.textContent = option ? option.textContent : "";

    menu.querySelectorAll(".cselect-option").forEach((button) => {
      const value = button.getAttribute("data-value");
      button.setAttribute("aria-selected", value === selectEl.value ? "true" : "false");
    });
  };

  const rebuild = () => {
    menu.innerHTML = "";

    for (const option of Array.from(selectEl.options)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cselect-option";
      btn.setAttribute("role", "option");
      btn.setAttribute("data-value", option.value);
      btn.textContent = option.textContent;

      btn.addEventListener("click", () => {
        selectEl.value = option.value;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        syncLabel();
        close();
      });

      menu.appendChild(btn);
    }

    syncLabel();
  };

  rebuild();

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    if (wrapper.classList.contains("open")) close();
    else open();
  });

  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target) && !menu.contains(event.target)) close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  window.addEventListener("resize", handleViewportChange);
  document.addEventListener("scroll", handleViewportChange, true);

  selectEl.addEventListener("change", syncLabel);
}

export function setupCustomSelects() {
  document.querySelectorAll("select[data-cselect]").forEach(setupCustomSelect);
}
