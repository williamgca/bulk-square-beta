(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileCount = document.getElementById("fileCount");
  const totalSize = document.getElementById("totalSize");
  const processBtn = document.getElementById("processBtn");
  const cleanBtn = document.getElementById("cleanBtn");
  const statusEl = document.getElementById("status");

  const colorPicker = document.getElementById("colorPicker");
  const colorHex = document.getElementById("colorHex");
  const formatSelect = document.getElementById("formatSelect");
  const sizeMode = document.getElementById("sizeMode");
  const sizeValue = document.getElementById("sizeValue");
  const sizeValueWrap = document.getElementById("sizeValueWrap");
  const marginYInput = document.getElementById("marginY");
  const downloadMode = document.getElementById("downloadMode");
  const autoClean = document.getElementById("autoClean");

  const previewCard = document.querySelector(".preview-card");
  const previewWrap = document.querySelector(".preview");
  const previewImg = document.getElementById("previewImg");
  const previewPlaceholder = document.getElementById("previewPlaceholder");

  const fileListEl = document.getElementById("fileList");

  /**
   * Each item:
   * { id: string, file: File, url: string }
   */
  let items = [];
  let idSeq = 0;

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    idSeq += 1;
    return `id_${Date.now()}_${idSeq}`;
  }

  function setStatus(msg, type) {
    statusEl.textContent = msg || "";
    statusEl.classList.remove("error", "ok");
    if (type) statusEl.classList.add(type);
  }

  function formatMB(bytes) {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }

  function isHex(v) {
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function bytesToNice(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function sanitizeBaseName(filename) {
    const name = String(filename || "image");
    const base = name.replace(/\.[^/.]+$/, "");
    return (base || "image").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  }

  function computeFallbackFilename(file, fmt, order, orderTotal, marginY) {
    const padLen = String(orderTotal || order || 1).length;
    const prefix = String(order || 1).padStart(padLen, "0");
    const base = sanitizeBaseName(file && file.name ? file.name : "image");
    const ext = fmt === "jpg" ? "jpg" : fmt;
    const m = Number(marginY) > 0 ? `_my${Number(marginY)}` : "";
    return `${prefix}_${base}_square${m}.${ext}`;
  }

  function parseFilenameFromContentDisposition(header) {
    if (!header) return null;
    const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(header);
    const raw = (m && (m[1] || m[2] || m[3])) ? String(m[1] || m[2] || m[3]).trim() : "";
    if (!raw) return null;
    try {
      return decodeURIComponent(raw.replace(/^"|"$/g, ""));
    } catch {
      return raw.replace(/^"|"$/g, "");
    }
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke later (too early can break downloads in some browsers)
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  function updateCounters() {
    fileCount.textContent = String(items.length);
    const bytes = items.reduce((acc, it) => acc + (it.file ? it.file.size : 0), 0);
    totalSize.textContent = formatMB(bytes);
    processBtn.disabled = items.length === 0;
  }

  function setPreviewState({ text, hasImage }) {
    if (!previewWrap) return;
    if (hasImage) previewWrap.classList.add("has-image");
    else previewWrap.classList.remove("has-image");
    if (previewPlaceholder && typeof text === "string") previewPlaceholder.textContent = text;
  }

  function updateSizeModeUI() {
    const mode = sizeMode.value;
    if (mode === "fixed") {
      sizeValueWrap.classList.remove("hidden");
    } else {
      sizeValueWrap.classList.add("hidden");
    }
  }

  function getSettingsOrThrow() {
    const color = String(colorHex.value || "").trim().toLowerCase();
    if (!isHex(color)) throw new Error("Color inválido. Usa HEX tipo #ffffff.");

    const fmt = formatSelect.value;
    const mode = sizeMode.value;
    const size = Number(sizeValue.value);
    if (mode === "fixed") {
      if (!Number.isFinite(size) || size <= 0 || size > 10000) {
        throw new Error("Tamaño inválido. Debe ser un número entre 1 y 10000.");
      }
    }

    const marginY = Math.max(0, Math.round(Number(marginYInput.value) || 0));
    if (!Number.isFinite(marginY) || marginY < 0 || marginY > 10000) {
      throw new Error("Margen inválido. Debe ser un número entre 0 y 10000.");
    }

    const dl = (downloadMode && downloadMode.value) ? downloadMode.value : "zip";
    const shouldAutoClean = !!(autoClean && autoClean.checked);

    return { color, fmt, mode, size, marginY, dl, shouldAutoClean };
  }

  function appendCommonFields(fd, { color, fmt, mode, size, marginY }) {
    fd.append("color", color);
    fd.append("format", fmt);
    fd.append("sizeMode", mode);
    if (mode === "fixed") fd.append("size", String(size));
    fd.append("margin", String(marginY || 0));
  }

  async function fetchZip({ color, fmt, mode, size, marginY, zipMode }) {
    const fd = new FormData();

    // Add an order marker to the multipart filename so the server can enforce
    // a stable order even if the upload order changes in transit.
    const padLen = String(items.length).length;
    items.forEach((it, idx) => {
      const prefix = String(idx + 1).padStart(padLen, "0");
      fd.append("images", it.file, `__o${prefix}__${it.file.name}`);
    });

    appendCommonFields(fd, { color, fmt, mode, size, marginY });
    fd.append("downloadMode", zipMode);

    const resp = await fetch("/api/process", { method: "POST", body: fd });
    if (!resp.ok) {
      let errMsg = `Error ${resp.status}`;
      try {
        const data = await resp.json();
        if (data && data.error) errMsg = data.error;
      } catch { }
      throw new Error(errMsg);
    }

    return await resp.blob();
  }

  async function fetchSingle({ file, color, fmt, mode, size, marginY, order, orderTotal }) {
    const fd = new FormData();
    fd.append("image", file, file.name);
    appendCommonFields(fd, { color, fmt, mode, size, marginY });
    fd.append("order", String(order));
    fd.append("orderTotal", String(orderTotal));

    const resp = await fetch("/api/process-single", { method: "POST", body: fd });
    if (!resp.ok) {
      let errMsg = `Error ${resp.status}`;
      try {
        const data = await resp.json();
        if (data && data.error) errMsg = data.error;
      } catch { }
      throw new Error(errMsg);
    }

    const blob = await resp.blob();
    const cd = resp.headers.get("content-disposition") || "";
    const filename = parseFilenameFromContentDisposition(cd);
    return { blob, filename };
  }

  async function prefetchSingles({ color, fmt, mode, size, marginY, concurrency }) {
    const total = items.length;
    const results = new Array(total);
    let next = 0;
    let done = 0;

    const c = Math.max(1, Math.min(concurrency || 4, total));

    async function worker() {
      while (true) {
        const i = next;
        next += 1;
        if (i >= total) return;

        const { blob, filename } = await fetchSingle({
          file: items[i].file,
          color,
          fmt,
          mode,
          size,
          marginY,
          order: i + 1,
          orderTotal: total
        });

        results[i] = { blob, filename };
        done += 1;
        setStatus(`Procesando imágenes… ${done}/${total}`);
      }
    }

    const workers = [];
    for (let i = 0; i < c; i++) workers.push(worker());
    await Promise.all(workers);

    return results;
  }

  // ---------- Custom select (fixes unreadable native dropdowns in some browsers) ----------
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
    wrapper.appendChild(menu);

    const close = () => {
      wrapper.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    };

    const open = () => {
      wrapper.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
    };

    const syncLabel = () => {
      const opt = selectEl.options[selectEl.selectedIndex];
      valueEl.textContent = opt ? opt.textContent : "";
      menu.querySelectorAll(".cselect-option").forEach((btn) => {
        const v = btn.getAttribute("data-value");
        btn.setAttribute("aria-selected", v === selectEl.value ? "true" : "false");
      });
    };

    const rebuild = () => {
      menu.innerHTML = "";
      for (const opt of Array.from(selectEl.options)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cselect-option";
        btn.setAttribute("role", "option");
        btn.setAttribute("data-value", opt.value);
        btn.textContent = opt.textContent;
        btn.addEventListener("click", () => {
          selectEl.value = opt.value;
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
          syncLabel();
          close();
        });
        menu.appendChild(btn);
      }
      syncLabel();
    };

    rebuild();

    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      if (wrapper.classList.contains("open")) close();
      else open();
    });

    document.addEventListener("click", (e) => {
      if (!wrapper.contains(e.target)) close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    selectEl.addEventListener("change", syncLabel);
  }

  function setupCustomSelects() {
    document.querySelectorAll("select[data-cselect]").forEach(setupCustomSelect);
  }

  // ---------- File list render + drag reorder + delete ----------
  let dragIndex = null;

  function renderFileList() {
    if (!fileListEl) return;

    if (!items.length) {
      fileListEl.innerHTML = `<div class="file-empty">No hay imágenes. Agrega algunas para verlas aquí.</div>`;
      return;
    }

    fileListEl.innerHTML = "";

    items.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "file-item";
      row.draggable = true;
      row.dataset.index = String(idx);

      const thumb = document.createElement("img");
      thumb.className = "file-thumb";
      thumb.src = it.url;
      thumb.alt = it.file.name;

      const meta = document.createElement("div");
      meta.className = "file-meta";

      const name = document.createElement("div");
      name.className = "file-name";
      name.textContent = it.file.name;

      const sub = document.createElement("div");
      sub.className = "file-sub";
      sub.textContent = `#${idx + 1} • ${bytesToNice(it.file.size)}`;

      meta.appendChild(name);
      meta.appendChild(sub);

      const actions = document.createElement("div");
      actions.className = "file-actions";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "iconbtn";
      del.textContent = "Eliminar";
      del.addEventListener("click", (e) => {
        e.preventDefault();
        removeAt(idx);
      });

      actions.appendChild(del);

      row.appendChild(thumb);
      row.appendChild(meta);
      row.appendChild(actions);

      // drag handlers
      row.addEventListener("dragstart", (e) => {
        dragIndex = idx;
        row.classList.add("dragging");
        try {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(idx));
        } catch { }
      });

      row.addEventListener("dragend", () => {
        dragIndex = null;
        row.classList.remove("dragging");
        Array.from(fileListEl.querySelectorAll(".file-item")).forEach((n) => n.classList.remove("drag-over"));
      });

      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        row.classList.add("drag-over");
        try { e.dataTransfer.dropEffect = "move"; } catch { }
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over");
      });

      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drag-over");

        const to = idx;
        const from = dragIndex;
        if (from === null || from === undefined) return;
        if (from === to) return;

        moveItem(from, to);
      });

      fileListEl.appendChild(row);
    });
  }

  function moveItem(from, to) {
    if (from < 0 || from >= items.length) return;
    if (to < 0 || to >= items.length) return;

    const copy = items.slice();
    const [m] = copy.splice(from, 1);
    copy.splice(to, 0, m);
    items = copy;

    renderFileList();
    schedulePreviewUpdate();
  }

  function removeAt(idx) {
    if (idx < 0 || idx >= items.length) return;
    const it = items[idx];
    try { URL.revokeObjectURL(it.url); } catch { }
    items.splice(idx, 1);

    updateCounters();
    renderFileList();
    schedulePreviewUpdate();
    setStatus(items.length ? "Imagen eliminada." : "Lista vacía.", items.length ? undefined : undefined);
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith("image/"));
    if (!incoming.length) return;

    incoming.forEach((file) => {
      const url = URL.createObjectURL(file);
      items.push({ id: uid(), file, url });
    });

    updateCounters();
    renderFileList();
    schedulePreviewUpdate();
    setStatus(`${incoming.length} imagen(es) agregada(s). Total: ${items.length}.`);
  }

  function cleanAll({ silent } = {}) {
    items.forEach((it) => {
      try { URL.revokeObjectURL(it.url); } catch { }
    });
    items = [];

    if (previewImg) previewImg.removeAttribute("src");
    setPreviewState({ text: "Sube imágenes para ver el preview.", hasImage: false });

    updateCounters();
    renderFileList();

    // allow selecting the same file again
    if (fileInput) fileInput.value = "";

    if (!silent) setStatus("Listo. Limpio para empezar de 0.", "ok");
  }

  // ---------- Preview (always from first item in current order) ----------
  let previewTimer = null;
  let previewSeq = 0;
  let previewUrl = null;

  function schedulePreviewUpdate() {
    if (!previewCard) return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => updatePreview(), 350);
  }

  async function updatePreview() {
    if (!previewCard) return;

    previewSeq += 1;
    const seq = previewSeq;

    if (!items.length) {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      if (previewImg) previewImg.removeAttribute("src");
      setPreviewState({ text: "Sube imágenes para ver el preview.", hasImage: false });
      return;
    }

    let settings;
    try {
      settings = getSettingsOrThrow();
    } catch (e) {
      setPreviewState({ text: e && e.message ? e.message : "Ajustes inválidos.", hasImage: false });
      return;
    }

    setPreviewState({ text: "Generando preview…", hasImage: false });

    try {
      const { blob } = await fetchSingle({
        file: items[0].file,
        color: settings.color,
        fmt: settings.fmt,
        mode: settings.mode,
        size: settings.size,
        marginY: settings.marginY,
        order: 1,
        orderTotal: items.length
      });

      if (seq !== previewSeq) return; // stale

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      if (previewImg) previewImg.src = previewUrl;
      setPreviewState({ text: "", hasImage: true });
    } catch (e) {
      console.error(e);
      setPreviewState({ text: "No se pudo generar el preview.", hasImage: false });
    }
  }

  // ---------- Dropzone / Input (ADD behavior) ----------
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
    // reset to allow adding same file again later
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files) addFiles(dt.files);
  });

  // ---------- Form events ----------
  colorPicker.addEventListener("input", () => {
    colorHex.value = colorPicker.value.toLowerCase();
    schedulePreviewUpdate();
  });

  colorHex.addEventListener("input", () => {
    const v = colorHex.value.trim();
    if (isHex(v)) {
      colorPicker.value = v;
      colorHex.style.borderColor = "rgba(255,255,255,0.12)";
    } else {
      colorHex.style.borderColor = "rgba(248,113,113,0.8)";
    }
    schedulePreviewUpdate();
  });

  sizeMode.addEventListener("change", () => {
    updateSizeModeUI();
    schedulePreviewUpdate();
  });

  sizeValue.addEventListener("input", () => {
    schedulePreviewUpdate();
  });

  formatSelect.addEventListener("change", () => {
    schedulePreviewUpdate();
  });

  marginYInput.addEventListener("input", () => {
    schedulePreviewUpdate();
  });

  cleanBtn.addEventListener("click", () => {
    cleanAll();
  });

  // ---------- Process ----------
  processBtn.addEventListener("click", async () => {
    try {
      if (!items.length) return;

      setStatus("Procesando…");
      processBtn.disabled = true;

      const settings = getSettingsOrThrow();

      // 1) ZIP (single request)
      if (settings.dl === "zip") {
        const blob = await fetchZip({
          color: settings.color,
          fmt: settings.fmt,
          mode: settings.mode,
          size: settings.size,
          marginY: settings.marginY,
          zipMode: "zip"
        });

        triggerDownload(blob, "bulk-square-results.zip");
        setStatus("Listo. ZIP descargado.", "ok");
        processBtn.disabled = false;

        if (settings.shouldAutoClean) cleanAll({ silent: true });
        return;
      }

      // 2) Folder: download a ZIP that contains a standard folder prefix.
      if (settings.dl === "folder") {
        const blob = await fetchZip({
          color: settings.color,
          fmt: settings.fmt,
          mode: settings.mode,
          size: settings.size,
          marginY: settings.marginY,
          zipMode: "folder"
        });

        triggerDownload(blob, "bulk-square-results.zip");
        setStatus("Listo. ZIP con carpeta descargado (en Descargas).", "ok");
        processBtn.disabled = false;

        if (settings.shouldAutoClean) cleanAll({ silent: true });
        return;
      }

      // 3) Separate downloads (fast):
      // - Prefetch concurrently to reduce total time.
      // - Trigger downloads from last → first so the Downloads folder sorted by \"most recent\" shows
      //   the same order the user sees here.
      setStatus(`Procesando imágenes… 0/${items.length}`);
      const results = await prefetchSingles({
        color: settings.color,
        fmt: settings.fmt,
        mode: settings.mode,
        size: settings.size,
        marginY: settings.marginY,
        concurrency: 6
      });

      const total = items.length;
      setStatus(`Iniciando descargas… 0/${total}`);

      for (let i = total - 1; i >= 0; i--) {
        const step = total - i;
        setStatus(`Iniciando descargas… ${step}/${total}`);

        const r = results[i];
        const filename = (r && r.filename) ? r.filename : computeFallbackFilename(items[i].file, settings.fmt, i + 1, total, settings.marginY);
        triggerDownload(r.blob, filename);

        // Small spacing so the browser registers each download, without adding ~1s overhead.
        await sleep(45);
      }

      setStatus("Listo. Descargas iniciadas.", "ok");
      processBtn.disabled = false;

      if (settings.shouldAutoClean) cleanAll({ silent: true });
      return;
    } catch (e) {
      console.error(e);
      setStatus(e && e.message ? e.message : "Falló el proceso. Revisa la consola del navegador.", "error");
      processBtn.disabled = false;
    }
  });

  // ---------- Init ----------
  setStatus("Agrega imágenes para comenzar.");
  setupCustomSelects();
  updateSizeModeUI();
  updateCounters();
  renderFileList();
  schedulePreviewUpdate();
})();