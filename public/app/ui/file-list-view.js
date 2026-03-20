export function createFileListView({ container, formatBytes, onRemove, onMove, onToggleSelect, onDownloadOne, t }) {
  let dragIndex = null;

  function render(items) {
    if (!container) return;

    if (!items.length) {
      container.innerHTML = `<div class="file-empty">${t("fileEmpty")}</div>`;
      return;
    }

    container.innerHTML = "";

    items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "file-item";
      row.draggable = true;
      row.dataset.index = String(index);

      const thumb = document.createElement("img");
      thumb.className = "file-thumb";
      thumb.src = item.processedThumbUrl || item.url;
      thumb.alt = item.file.name;

      if (item.selected) row.classList.add("is-selected");

      const check = document.createElement("div");
      check.className = "file-check";
      check.textContent = "✓";

      const meta = document.createElement("div");
      meta.className = "file-meta";

      const name = document.createElement("div");
      name.className = "file-name";
      name.textContent = item.file.name;

      const sub = document.createElement("div");
      sub.className = "file-sub";
      sub.textContent = `#${index + 1} • ${formatBytes(item.file.size)}`;

      meta.appendChild(name);
      meta.appendChild(sub);

      const actions = document.createElement("div");
      actions.className = "file-actions";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "iconbtn";
      del.textContent = "X";
      del.setAttribute("aria-label", t("removeItem", { name: item.file.name }));
      del.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onRemove(index);
      });

      const dl = document.createElement("button");
      dl.type = "button";
      dl.className = "iconbtn";
      dl.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 3v10m0 0l4-4m-4 4l-4-4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3\"/></svg>";
      dl.setAttribute("aria-label", t("downloadItem", { name: item.file.name }));
      dl.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onDownloadOne(index);
      });

      actions.appendChild(dl);
      actions.appendChild(del);
      row.appendChild(check);
      row.appendChild(thumb);
      row.appendChild(meta);
      row.appendChild(actions);

      row.addEventListener("click", (event) => {
        const target = event.target;
        if (target && target.closest && target.closest(".file-actions")) return;
        onToggleSelect(index);
      });

      row.addEventListener("dragstart", (event) => {
        dragIndex = index;
        row.classList.add("dragging");
        try {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(index));
        } catch {
          // ignore
        }
      });

      row.addEventListener("dragend", () => {
        dragIndex = null;
        row.classList.remove("dragging");
        Array.from(container.querySelectorAll(".file-item")).forEach((node) => node.classList.remove("drag-over"));
      });

      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        row.classList.add("drag-over");
        try {
          event.dataTransfer.dropEffect = "move";
        } catch {
          // ignore
        }
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over");
      });

      row.addEventListener("drop", (event) => {
        event.preventDefault();
        row.classList.remove("drag-over");

        const from = dragIndex;
        const to = index;
        if (from === null || from === undefined || from === to) return;

        onMove(from, to);
      });

      container.appendChild(row);
    });
  }

  return {
    render
  };
}
