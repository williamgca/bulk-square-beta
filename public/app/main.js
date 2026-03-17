import { DOWNLOAD_PARALLEL_REQUESTS, MAX_SIZE, REMOVE_BG_FEATURE_ENABLED } from "./config.js";
import { createItemsStore } from "./state/items-store.js";
import { createBackgroundRemovalService } from "./services/background-removal.js";
import { createProcessApi } from "./services/api-client.js";
import { triggerDownload } from "./services/download.js";
import { setupCustomSelects } from "./ui/custom-select.js";
import { createFileListView } from "./ui/file-list-view.js";
import { createPreviewController } from "./ui/preview-controller.js";
import { createStatusView } from "./ui/status-view.js";
import { computeFallbackFilename } from "./utils/file.js";
import { bytesToNice, formatMB } from "./utils/format.js";
import { isHex } from "./utils/validation.js";

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }

  return element;
}

function getUiRefs() {
  return {
    dropzone: requireElement("dropzone"),
    fileInput: requireElement("fileInput"),
    fileCount: requireElement("fileCount"),
    totalSize: requireElement("totalSize"),
    processBtn: requireElement("processBtn"),
    downloadSelectedBtn: requireElement("downloadSelectedBtn"),
    cleanBtn: requireElement("cleanBtn"),
    statusEl: requireElement("status"),
    colorPicker: requireElement("colorPicker"),
    colorHex: requireElement("colorHex"),
    paddingField: requireElement("paddingField"),
    removeBgToggle: document.getElementById("removeBg"),
    formatSelect: requireElement("formatSelect"),
    sizeMode: requireElement("sizeMode"),
    sizeValue: requireElement("sizeValue"),
    sizeValueWrap: requireElement("sizeValueWrap"),
    marginYInput: requireElement("marginY"),
    marginClearBtn: document.getElementById("marginClearBtn"),
    downloadMode: requireElement("downloadMode"),
    autoClean: requireElement("autoClean"),
    previewCard: document.querySelector(".preview"),
    previewWrap: document.querySelector(".preview"),
    previewImg: requireElement("previewImg"),
    previewPlaceholder: requireElement("previewPlaceholder"),
    fileListEl: requireElement("fileList"),
    themeToggle: document.getElementById("themeToggle"),
    themeLabel: document.getElementById("themeLabel"),
    sidebarMenu: document.querySelector(".sidebar-menu"),
    mediaZone: document.querySelector(".media-zone"),
    quickPanel: document.querySelector(".quick-panel"),
    workspaceMain: document.querySelector(".workspace-main")
  };
}

(function bootstrap() {
  const THEME_STORAGE_KEY = "bulk-square-theme";
  const THUMB_DEBOUNCE_MS = 220;
  const THUMB_PARALLEL_REQUESTS = 2;
  const MIN_THUMB_SIZE = 320;
  const MAX_THUMB_SIZE = 640;

  const ui = getUiRefs();
  const store = createItemsStore();
  const statusView = createStatusView(ui.statusEl);
  const backgroundRemovalService = createBackgroundRemovalService();
  const api = createProcessApi();
  let thumbsTimer = null;
  let thumbsSeq = 0;
  let thumbRenderFrame = null;

  function applyTheme(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", nextTheme);
    if (ui.themeToggle) ui.themeToggle.checked = nextTheme === "dark";
    if (ui.themeLabel) ui.themeLabel.textContent = nextTheme === "dark" ? "Modo claro" : "Modo oscuro";
  }

  function initTheme() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme = savedTheme === "light" || savedTheme === "dark"
      ? savedTheme
      : (prefersDark ? "dark" : "light");

    applyTheme(initialTheme);

    if (ui.themeToggle) {
      ui.themeToggle.addEventListener("change", () => {
        const nextTheme = ui.themeToggle.checked ? "dark" : "light";
        applyTheme(nextTheme);
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      });
    }
  }

  const fileListView = createFileListView({
    container: ui.fileListEl,
    formatBytes: bytesToNice,
    onRemove: (index) => {
      if (!store.removeAt(index)) return;
      refreshUi({ schedulePreview: true });
      scheduleThumbsUpdate();
      statusView.setStatus(store.getItems().length ? "Imagen eliminada." : "Lista vacía.");
    },
    onMove: (from, to) => {
      if (!store.moveItem(from, to)) return;
      refreshUi({ schedulePreview: true });
    },
    onToggleSelect: (index) => {
      if (!store.toggleSelect(index)) return;
      refreshUi();
    },
    onDownloadOne: async (index) => {
      const items = store.getItems();
      const item = items[index];
      if (!item) return;

      try {
        const settings = getSettingsOrThrow();
        statusView.setStatus(`Descargando ${item.file.name}...`);
        await downloadSeparate(settings, [item]);
        statusView.setStatus("Descarga iniciada.", "ok");
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        statusView.setStatus(error && error.message ? error.message : "No se pudo descargar la imagen.", "error");
      }
    }
  });

  function updatePaddingUIState() {
    const isRemoveBgOn = REMOVE_BG_FEATURE_ENABLED && !!(ui.removeBgToggle && ui.removeBgToggle.checked);
    ui.colorPicker.disabled = isRemoveBgOn;
    ui.colorHex.disabled = isRemoveBgOn;
    ui.paddingField.classList.toggle("is-disabled", isRemoveBgOn);
  }

  function updateSizeModeUi() {
    if (ui.sizeMode.value === "fixed") ui.sizeValueWrap.classList.remove("hidden");
    else ui.sizeValueWrap.classList.add("hidden");
  }

  function getSettingsOrThrow() {
    const removeBg = REMOVE_BG_FEATURE_ENABLED && !!(ui.removeBgToggle && ui.removeBgToggle.checked);
    const color = String(ui.colorHex.value || "").trim().toLowerCase();

    if (!removeBg && !isHex(color)) {
      throw new Error("Color inválido. Usa HEX tipo #ffffff.");
    }

    const format = ui.formatSelect.value;
    const sizeMode = ui.sizeMode.value;
    const sizeValue = Number(ui.sizeValue.value);

    if (sizeMode === "fixed") {
      if (!Number.isFinite(sizeValue) || sizeValue <= 0 || sizeValue > MAX_SIZE) {
        throw new Error(`Tamaño inválido. Debe ser un número entre 1 y ${MAX_SIZE}.`);
      }
    }

    const marginY = Math.max(0, Math.round(Number(ui.marginYInput.value) || 0));
    if (!Number.isFinite(marginY) || marginY < 0 || marginY > MAX_SIZE) {
      throw new Error(`Margen inválido. Debe ser un número entre 0 y ${MAX_SIZE}.`);
    }

    const downloadMode = ui.downloadMode.value || "separate";
    const shouldAutoClean = !!ui.autoClean.checked;

    return {
      color,
      format,
      sizeMode,
      sizeValue,
      marginY,
      downloadMode,
      shouldAutoClean,
      removeBg
    };
  }

  const previewController = createPreviewController({
    previewCard: ui.previewCard,
    previewWrap: ui.previewWrap,
    previewImg: ui.previewImg,
    previewPlaceholder: ui.previewPlaceholder,
    getItems: store.getItems,
    getSettingsOrThrow,
    getEffectiveFile: backgroundRemovalService.getEffectiveFile,
    fetchSingle: api.fetchSingle
  });

  function refreshCounters() {
    ui.fileCount.textContent = String(store.getItems().length);
    ui.totalSize.textContent = formatMB(store.totalBytes());
    ui.processBtn.disabled = store.getItems().length === 0;
    ui.downloadSelectedBtn.disabled = store.selectedCount() === 0;
  }

  function refreshUi({ schedulePreview = false } = {}) {
    refreshCounters();
    fileListView.render(store.getItems());
    ui.downloadSelectedBtn.disabled = store.selectedCount() === 0;
    if (schedulePreview) previewController.scheduleUpdate();
  }

  function makeThumbSettingsKey(settings) {
    return [
      settings.color,
      settings.format,
      settings.sizeMode,
      String(settings.sizeValue || ""),
      String(settings.marginY || 0),
      settings.removeBg ? "1" : "0"
    ].join("|");
  }

  function queueThumbRender() {
    if (thumbRenderFrame) return;
    thumbRenderFrame = requestAnimationFrame(() => {
      thumbRenderFrame = null;
      fileListView.render(store.getItems());
    });
  }

  async function updateProcessedThumbs() {
    thumbsSeq += 1;
    const seq = thumbsSeq;
    const items = store.getItems();
    if (!items.length) return;

    let settings;
    try {
      settings = getSettingsOrThrow();
    } catch {
      return;
    }

    const keyBase = makeThumbSettingsKey(settings);
    const thumbSize = settings.sizeMode === "fixed"
      ? Math.max(MIN_THUMB_SIZE, Math.min(MAX_THUMB_SIZE, Math.round(settings.sizeValue || MAX_THUMB_SIZE)))
      : 512;
    let needsRender = false;

    for (const item of items) {
      const expectedKey = `${item.id}|${keyBase}|${thumbSize}`;
      if (item.processedThumbKey !== expectedKey && item.processedThumbUrl) {
        try {
          URL.revokeObjectURL(item.processedThumbUrl);
        } catch {
          // ignore
        }
        item.processedThumbUrl = null;
        item.processedThumbKey = null;
        needsRender = true;
      }
    }

    if (needsRender) queueThumbRender();

    const workerCount = Math.max(1, Math.min(THUMB_PARALLEL_REQUESTS, items.length));
    let cursor = 0;

    const worker = async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;

        const item = items[index];
        const itemKey = `${item.id}|${keyBase}|${thumbSize}`;
        if (item.processedThumbUrl && item.processedThumbKey === itemKey) continue;

        try {
          const thumbFile = await backgroundRemovalService.getEffectiveFile(item, settings);
          const { blob } = await api.fetchSingle({
            file: thumbFile,
            color: settings.color,
            format: settings.format,
            sizeMode: "fixed",
            sizeValue: thumbSize,
            marginY: settings.marginY,
            order: 1,
            orderTotal: 1,
            removeBg: settings.removeBg
          });

          if (seq !== thumbsSeq) return;

          const nextUrl = URL.createObjectURL(blob);
          const prevUrl = item.processedThumbUrl;
          item.processedThumbUrl = nextUrl;
          item.processedThumbKey = itemKey;
          if (prevUrl && prevUrl !== nextUrl) {
            try {
              URL.revokeObjectURL(prevUrl);
            } catch {
              // ignore
            }
          }

          queueThumbRender();
        } catch {
          if (seq !== thumbsSeq) return;
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  function scheduleThumbsUpdate() {
    if (thumbsTimer) clearTimeout(thumbsTimer);
    thumbsTimer = setTimeout(() => {
      updateProcessedThumbs();
    }, THUMB_DEBOUNCE_MS);
  }

  function syncMainPanelHeight() {
    if (!ui.sidebarMenu || !ui.mediaZone || !ui.quickPanel || !ui.workspaceMain) return;

    if (window.innerWidth <= 1080) {
      ui.mediaZone.style.removeProperty("min-height");
      return;
    }

    const sidebarHeight = Math.ceil(ui.sidebarMenu.getBoundingClientRect().height);
    const quickPanelHeight = Math.ceil(ui.quickPanel.getBoundingClientRect().height);
    const mainGap = Number.parseFloat(window.getComputedStyle(ui.workspaceMain).gap || "0") || 0;
    const targetMediaHeight = Math.floor(sidebarHeight - quickPanelHeight - mainGap);

    if (targetMediaHeight > 0) {
      ui.mediaZone.style.minHeight = `${targetMediaHeight}px`;
    } else {
      ui.mediaZone.style.removeProperty("min-height");
    }
  }

  function cleanAll({ silent = false } = {}) {
    thumbsSeq += 1;
    if (thumbsTimer) {
      clearTimeout(thumbsTimer);
      thumbsTimer = null;
    }
    if (thumbRenderFrame) {
      cancelAnimationFrame(thumbRenderFrame);
      thumbRenderFrame = null;
    }

    store.clear();
    ui.fileInput.value = "";
    previewController.reset();
    refreshUi();
    if (!silent) statusView.setStatus("Listo. Limpio para empezar de 0.", "ok");
  }

  function addFiles(fileList) {
    const added = store.addFiles(fileList);
    if (!added) return;
    refreshUi({ schedulePreview: true });
    scheduleThumbsUpdate();
    statusView.setStatus(`${added} imagen(es) agregada(s). Total: ${store.getItems().length}.`);
  }

  async function downloadZip(settings, zipMode, items) {
    const blob = await api.fetchZip({
      items,
      getEffectiveFile: backgroundRemovalService.getEffectiveFile,
      onItemStart: (index, total) => {
        if (settings.removeBg) statusView.setStatus(`Removiendo fondo... ${index + 1}/${total}`);
      },
      color: settings.color,
      format: settings.format,
      sizeMode: settings.sizeMode,
      sizeValue: settings.sizeValue,
      marginY: settings.marginY,
      zipMode,
      removeBg: settings.removeBg
    });

    triggerDownload(blob, "bulk-square-results.zip");
  }

  async function downloadSeparate(settings, items) {
    const DOWNLOAD_TRIGGER_INTERVAL_MS = 180;
    const total = items.length;
    const maxWorkers = Math.max(1, Math.min(DOWNLOAD_PARALLEL_REQUESTS, total));
    const readyResults = new Array(total);
    let completed = 0;
    statusView.setStatus(`Procesando y descargando... 0/${total}`);

    const runOne = async (index) => {
      const result = await api.fetchSingle({
        file: await backgroundRemovalService.getEffectiveFile(items[index], settings),
        color: settings.color,
        format: settings.format,
        sizeMode: settings.sizeMode,
        sizeValue: settings.sizeValue,
        marginY: settings.marginY,
        order: index + 1,
        orderTotal: total,
        removeBg: settings.removeBg
      });

      readyResults[index] = result;

      completed += 1;
      statusView.setStatus(`Procesando y descargando... ${completed}/${total}`);
    };

    const workers = Array.from({ length: maxWorkers }, (_unused, workerIndex) => (async () => {
      for (let index = workerIndex; index < total; index += maxWorkers) {
        await runOne(index);
      }
    })());

    await Promise.all(workers);

    statusView.setStatus(`Iniciando descargas... 0/${total}`);
    let triggered = 0;
    for (let index = total - 1; index >= 0; index -= 1) {
      const ready = readyResults[index];
      if (!ready) {
        throw new Error("Faltan resultados de algunas imagenes. Intenta nuevamente.");
      }

      const filename = ready.filename || computeFallbackFilename(
        items[index].file,
        settings.format,
        index + 1,
        total,
        settings.marginY
      );
      triggerDownload(ready.blob, filename);
      triggered += 1;
      statusView.setStatus(`Iniciando descargas... ${triggered}/${total}`);

      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_TRIGGER_INTERVAL_MS));
      }
    }
  }

  function bindDropzone() {
    ui.dropzone.addEventListener("click", () => ui.fileInput.click());
    ui.dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") ui.fileInput.click();
    });

    ui.fileInput.addEventListener("change", () => {
      addFiles(ui.fileInput.files);
      ui.fileInput.value = "";
    });

    ["dragenter", "dragover"].forEach((evt) => {
      ui.dropzone.addEventListener(evt, (event) => {
        event.preventDefault();
        event.stopPropagation();
        ui.dropzone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((evt) => {
      ui.dropzone.addEventListener(evt, (event) => {
        event.preventDefault();
        event.stopPropagation();
        ui.dropzone.classList.remove("dragover");
      });
    });

    ui.dropzone.addEventListener("drop", (event) => {
      const dt = event.dataTransfer;
      if (dt && dt.files) addFiles(dt.files);
    });
  }

  function bindFormEvents() {
    ui.colorPicker.addEventListener("input", () => {
      ui.colorHex.value = ui.colorPicker.value.toLowerCase();
      previewController.scheduleUpdate();
      scheduleThumbsUpdate();
    });

    ui.colorHex.addEventListener("input", () => {
      const value = ui.colorHex.value.trim();
      if (isHex(value)) {
        ui.colorPicker.value = value;
        ui.colorHex.style.borderColor = "var(--border)";
      } else {
        ui.colorHex.style.borderColor = "var(--danger)";
      }

      previewController.scheduleUpdate();
      scheduleThumbsUpdate();
    });

    if (ui.removeBgToggle) {
      ui.removeBgToggle.addEventListener("change", () => {
        updatePaddingUIState();
        previewController.scheduleUpdate();
        scheduleThumbsUpdate();
      });
    }

    ui.sizeMode.addEventListener("change", () => {
      updateSizeModeUi();
      previewController.scheduleUpdate();
      scheduleThumbsUpdate();
    });

    ui.sizeValue.addEventListener("input", () => {
      previewController.scheduleUpdate();
      scheduleThumbsUpdate();
    });
    ui.formatSelect.addEventListener("change", () => {
      previewController.scheduleUpdate();
      scheduleThumbsUpdate();
    });
    ui.marginYInput.addEventListener("input", () => {
      previewController.scheduleUpdate();
      scheduleThumbsUpdate();
    });

    if (ui.marginClearBtn) {
      ui.marginClearBtn.addEventListener("click", () => {
        ui.marginYInput.value = "0";
        ui.marginYInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    ui.cleanBtn.addEventListener("click", () => {
      cleanAll();
    });

    const runDownload = async ({ selectedOnly }) => {
      const allItems = store.getItems();
      const targetItems = selectedOnly ? store.getSelectedItems() : allItems;
      if (!targetItems.length) return;

      ui.processBtn.disabled = true;
      ui.downloadSelectedBtn.disabled = true;
      statusView.setStatus(selectedOnly ? "Descargando selección..." : "Descargando...");

      try {
        const settings = getSettingsOrThrow();

        if (settings.downloadMode === "zip") {
          await downloadZip(settings, "zip", targetItems);
          statusView.setStatus("Listo. ZIP descargado.", "ok");
        } else if (settings.downloadMode === "folder") {
          await downloadZip(settings, "folder", targetItems);
          statusView.setStatus("Listo. ZIP con carpeta descargado (en Descargas).", "ok");
        } else {
          await downloadSeparate(settings, targetItems);
          statusView.setStatus("Listo. Descargas iniciadas.", "ok");
        }

        if (!selectedOnly && settings.shouldAutoClean) cleanAll({ silent: true });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        statusView.setStatus(error && error.message ? error.message : "Falló la descarga. Revisa la consola del navegador.", "error");
      } finally {
        refreshCounters();
      }
    };

    ui.processBtn.addEventListener("click", async () => runDownload({ selectedOnly: false }));
    ui.downloadSelectedBtn.addEventListener("click", async () => runDownload({ selectedOnly: true }));
  }

  setupCustomSelects();
  initTheme();
  bindDropzone();
  bindFormEvents();
  document.querySelectorAll(".menu-group").forEach((group) => {
    group.addEventListener("toggle", () => {
      requestAnimationFrame(syncMainPanelHeight);
    });
  });
  window.addEventListener("resize", syncMainPanelHeight);
  updatePaddingUIState();
  updateSizeModeUi();
  refreshUi();
  previewController.scheduleUpdate();
  scheduleThumbsUpdate();
  requestAnimationFrame(syncMainPanelHeight);
  statusView.setStatus("Agrega imágenes para comenzar.");
})();
