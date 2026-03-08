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
    fileListEl: requireElement("fileList")
  };
}

(function bootstrap() {
  const ui = getUiRefs();
  const store = createItemsStore();
  const statusView = createStatusView(ui.statusEl);
  const backgroundRemovalService = createBackgroundRemovalService();
  const api = createProcessApi();

  const fileListView = createFileListView({
    container: ui.fileListEl,
    formatBytes: bytesToNice,
    onRemove: (index) => {
      if (!store.removeAt(index)) return;
      refreshUi({ schedulePreview: true });
      statusView.setStatus(store.getItems().length ? "Imagen eliminada." : "Lista vacía.");
    },
    onMove: (from, to) => {
      if (!store.moveItem(from, to)) return;
      refreshUi({ schedulePreview: true });
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
  }

  function refreshUi({ schedulePreview = false } = {}) {
    refreshCounters();
    fileListView.render(store.getItems());
    if (schedulePreview) previewController.scheduleUpdate();
  }

  function cleanAll({ silent = false } = {}) {
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
    statusView.setStatus(`${added} imagen(es) agregada(s). Total: ${store.getItems().length}.`);
  }

  async function downloadZip(settings, zipMode) {
    const blob = await api.fetchZip({
      items: store.getItems(),
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

  async function downloadSeparate(settings) {
    const items = store.getItems();
    const total = items.length;
    const maxWorkers = Math.max(1, Math.min(DOWNLOAD_PARALLEL_REQUESTS, total));
    let completed = 0;
    let nextDownloadIndex = total - 1;
    const readyResults = new Map();
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

      readyResults.set(index, result);
      while (readyResults.has(nextDownloadIndex)) {
        const ready = readyResults.get(nextDownloadIndex);
        readyResults.delete(nextDownloadIndex);
        const filename = ready.filename || computeFallbackFilename(
          items[nextDownloadIndex].file,
          settings.format,
          nextDownloadIndex + 1,
          total,
          settings.marginY
        );
        triggerDownload(ready.blob, filename);
        nextDownloadIndex -= 1;
      }

      completed += 1;
      statusView.setStatus(`Procesando y descargando... ${completed}/${total}`);
    };

    const workers = Array.from({ length: maxWorkers }, (_unused, workerIndex) => (async () => {
      for (let index = workerIndex; index < total; index += maxWorkers) {
        await runOne(index);
      }
    })());

    await Promise.all(workers);
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
    });

    ui.colorHex.addEventListener("input", () => {
      const value = ui.colorHex.value.trim();
      if (isHex(value)) {
        ui.colorPicker.value = value;
        ui.colorHex.style.borderColor = "rgba(255,255,255,0.12)";
      } else {
        ui.colorHex.style.borderColor = "rgba(248,113,113,0.8)";
      }

      previewController.scheduleUpdate();
    });

    if (ui.removeBgToggle) {
      ui.removeBgToggle.addEventListener("change", () => {
        updatePaddingUIState();
        previewController.scheduleUpdate();
      });
    }

    ui.sizeMode.addEventListener("change", () => {
      updateSizeModeUi();
      previewController.scheduleUpdate();
    });

    ui.sizeValue.addEventListener("input", () => previewController.scheduleUpdate());
    ui.formatSelect.addEventListener("change", () => previewController.scheduleUpdate());
    ui.marginYInput.addEventListener("input", () => previewController.scheduleUpdate());

    if (ui.marginClearBtn) {
      ui.marginClearBtn.addEventListener("click", () => {
        ui.marginYInput.value = "0";
        ui.marginYInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    ui.cleanBtn.addEventListener("click", () => {
      cleanAll();
    });

    ui.processBtn.addEventListener("click", async () => {
      if (!store.getItems().length) return;

      ui.processBtn.disabled = true;
      statusView.setStatus("Procesando...");

      try {
        const settings = getSettingsOrThrow();

        if (settings.downloadMode === "zip") {
          await downloadZip(settings, "zip");
          statusView.setStatus("Listo. ZIP descargado.", "ok");
        } else if (settings.downloadMode === "folder") {
          await downloadZip(settings, "folder");
          statusView.setStatus("Listo. ZIP con carpeta descargado (en Descargas).", "ok");
        } else {
          await downloadSeparate(settings);
          statusView.setStatus("Listo. Descargas iniciadas.", "ok");
        }

        if (settings.shouldAutoClean) cleanAll({ silent: true });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        statusView.setStatus(error && error.message ? error.message : "Falló el proceso. Revisa la consola del navegador.", "error");
      } finally {
        ui.processBtn.disabled = store.getItems().length === 0;
      }
    });
  }

  setupCustomSelects();
  bindDropzone();
  bindFormEvents();
  updatePaddingUIState();
  updateSizeModeUi();
  refreshUi();
  previewController.scheduleUpdate();
  statusView.setStatus("Agrega imágenes para comenzar.");
})();
