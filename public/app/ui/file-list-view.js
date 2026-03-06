export function createFileListView({ container, formatBytes, onRemove, onMove }) {
  let dragIndex = null;

  function render(items) {
    if (!container) return;

    if (!items.length) {
      container.innerHTML = "<div class=\"file-empty\">No hay imágenes. Agrega algunas para verlas aquí.</div>";
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
      thumb.src = item.url;
      thumb.alt = item.file.name;

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
      del.textContent = "Eliminar";
      del.addEventListener("click", (event) => {
        event.preventDefault();
        onRemove(index);
      });

      actions.appendChild(del);
      row.appendChild(thumb);
      row.appendChild(meta);
      row.appendChild(actions);

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
