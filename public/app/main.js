import { DOWNLOAD_PARALLEL_REQUESTS, MAX_FILES_PER_BATCH, MAX_SIZE, REMOVE_BG_FEATURE_ENABLED } from "./config.js";
import { createItemsStore } from "./state/items-store.js";
import { createBackgroundRemovalService } from "./services/background-removal.js";
import { createProcessApi } from "./services/api-client.js";
import { createMediaSourceService } from "./services/media-source.js";
import { fetchRuntimeConfig } from "./services/runtime-config.js";
import { downloadBlobFromUrl, triggerDownload } from "./services/download.js";
import { createI18n } from "./i18n.js";
import { refreshCustomSelects, setupCustomSelects } from "./ui/custom-select.js";
import { createFileListView } from "./ui/file-list-view.js";
import { createPreviewController } from "./ui/preview-controller.js";
import { createStatusView } from "./ui/status-view.js";
import { collectDroppedFiles } from "./utils/drop-files.js";
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
    folderInput: requireElement("folderInput"),
    folderSelectBtn: requireElement("folderSelectBtn"),
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
    filenameMode: requireElement("filenameMode"),
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
    languageSelect: document.getElementById("languageSelect"),
    themeToggle: document.getElementById("themeToggle"),
    themeLabel: document.getElementById("themeLabel"),
    brandLogo: document.getElementById("brandLogo")
  };
}

(async function bootstrap() {
  const LANGUAGE_STORAGE_KEY = "bulk-square-language";
  const THEME_STORAGE_KEY = "bulk-square-theme";
  const THUMB_DEBOUNCE_MS = 220;
  const THUMB_PARALLEL_REQUESTS = 2;
  const MIN_THUMB_SIZE = 320;
  const MAX_THUMB_SIZE = 640;

  const ui = getUiRefs();
  const runtimeConfig = await fetchRuntimeConfig();
  const maxFilesPerBatch = runtimeConfig.maxFilesPerBatch || MAX_FILES_PER_BATCH;
  const initialLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) || "es";
  const i18n = createI18n(initialLanguage);
  const store = createItemsStore();
  const statusView = createStatusView(ui.statusEl);
  const backgroundRemovalService = createBackgroundRemovalService();
  const mediaSourceService = createMediaSourceService({
    blobStorageEnabled: runtimeConfig.blobStorageEnabled,
    storageProvider: runtimeConfig.storageProvider,
    getEffectiveFile: backgroundRemovalService.getEffectiveFile
  });
  const api = createProcessApi();
  let thumbsTimer = null;
  let thumbsSeq = 0;
  let thumbRenderFrame = null;

  function t(key, params) {
    return i18n.t(key, params);
  }

  function applyTranslations() {
    document.documentElement.lang = t("pageLanguage");

    document.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });

    document.querySelectorAll("[data-i18n-alt]").forEach((node) => {
      node.setAttribute("alt", t(node.dataset.i18nAlt));
    });

    document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
      node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
    });

    document.querySelectorAll("[data-i18n-tooltip]").forEach((node) => {
      node.setAttribute("data-tooltip", t(node.dataset.i18nTooltip));
    });

    document.querySelectorAll("[data-i18n-aria-label-template]").forEach((node) => {
      const templateKey = node.dataset.i18nAriaLabelTemplate;
      const paramKey = node.dataset.i18nAriaLabelParam;
      node.setAttribute("aria-label", t(templateKey, { label: t(paramKey) }));
    });

    if (ui.languageSelect) {
      ui.languageSelect.setAttribute("aria-label", t("languageSelectAria"));
      ui.languageSelect.value = i18n.getLanguage();
    }

    if (ui.themeToggle) ui.themeToggle.setAttribute("aria-label", t("themeSwitchAria"));

    refreshCustomSelects();
    refreshUi();
    previewController.scheduleUpdate();
  }

  function applyTheme(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", nextTheme);
    if (ui.themeToggle) ui.themeToggle.checked = nextTheme === "dark";
    if (ui.brandLogo) ui.brandLogo.src = nextTheme === "dark" ? "/logo(white).svg" : "/logo(black).svg";
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
    t,
    onRemove: async (index) => {
      const item = store.getItems()[index];
      if (!item) return;
      if (!store.removeAt(index)) return;
      refreshUi({ schedulePreview: true });
      scheduleThumbsUpdate();
      statusView.setStatus(store.getItems().length ? t("toastItemRemoved") : t("toastListEmpty"));

      try {
        await mediaSourceService.cleanupItems([item]);
        item.sourceUpload = null;
        item.removeBgUpload = null;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        statusView.setStatus(error && error.message ? error.message : t("toastStorageCleanupFailed"), "error");
      }
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
        statusView.setStatus(t("toastDownloadingFile", { name: item.file.name }));
        await downloadSeparate(settings, [item]);
        statusView.setStatus(t("toastDownloadStarted"), "ok");
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        statusView.setStatus(error && error.message ? error.message : t("toastDownloadFailed"), "error");
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
      throw new Error(t("toastColorInvalid"));
    }

    const format = ui.formatSelect.value;
    const sizeMode = ui.sizeMode.value;
    const sizeValue = Number(ui.sizeValue.value);

    if (sizeMode === "fixed") {
      if (!Number.isFinite(sizeValue) || sizeValue <= 0 || sizeValue > MAX_SIZE) {
        throw new Error(t("toastSizeInvalid", { max: MAX_SIZE }));
      }
    }

    const marginY = Math.max(0, Math.round(Number(ui.marginYInput.value) || 0));
    if (!Number.isFinite(marginY) || marginY < 0 || marginY > MAX_SIZE) {
      throw new Error(t("toastMarginInvalid", { max: MAX_SIZE }));
    }

    const downloadMode = ui.downloadMode.value || "separate";
    const filenameMode = ui.filenameMode.value === "original" ? "original" : "processed";
    const shouldAutoClean = !!ui.autoClean.checked;

    return {
      color,
      format,
      filenameMode,
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
    getProcessSource: mediaSourceService.ensureSource,
    fetchSingle: api.fetchSingle,
    t
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
          const source = await mediaSourceService.ensureSource(item, settings);
          const { blob } = await api.fetchSingle({
            source,
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

  function lockSettingsGroups() {
    const groups = document.querySelectorAll(".menu-group");
    groups.forEach((group) => {
      group.open = true;
      group.classList.add("menu-group-static");

      const summary = group.querySelector("summary");
      if (!summary) return;

      summary.tabIndex = -1;
      summary.setAttribute("aria-disabled", "true");
      summary.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      summary.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
        }
      });

      group.addEventListener("toggle", () => {
        if (!group.open) group.open = true;
      });
    });
  }

  async function cleanAll({ silent = false } = {}) {
    const itemsSnapshot = store.getItems().slice();
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
    ui.folderInput.value = "";
    previewController.reset();
    refreshUi();

    try {
      await mediaSourceService.cleanupItems(itemsSnapshot);
      itemsSnapshot.forEach((item) => {
        item.sourceUpload = null;
        item.removeBgUpload = null;
      });
      if (!silent) statusView.setStatus(t("toastListCleared"), "ok");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      statusView.setStatus(error && error.message ? error.message : t("toastStorageCleanupFailed"), "error");
    }
  }

  function addFiles(fileList) {
    const result = store.addFiles(fileList, { maxFiles: maxFilesPerBatch });
    if (!result.added) {
      if (result.skippedLimit) statusView.setStatus(t("toastFileLimitReached", { max: maxFilesPerBatch }), "error");
      else if (result.skippedUnsupported) statusView.setStatus(t("toastNoCompatibleImages"), "error");
      return;
    }

    refreshUi({ schedulePreview: true });
    scheduleThumbsUpdate();

    if (result.skippedLimit) {
      statusView.setStatus(t("toastImagesAddedWithLimit", { count: result.added, max: maxFilesPerBatch }), "ok");
    } else if (result.skippedUnsupported) {
      statusView.setStatus(t("toastImagesAddedWithSkipped", { count: result.added, skipped: result.skippedUnsupported }), "ok");
    } else {
      statusView.setStatus(t("toastImagesAdded", { count: result.added }), "ok");
    }
  }

  async function downloadZip(settings, zipMode, items) {
    const remoteFile = await api.createZipDownload({
      items,
      getProcessSource: mediaSourceService.ensureSource,
      onItemStart: (index, total) => {
        if (settings.removeBg) statusView.setStatus(t("toastRemovingBg", { current: index + 1, total }));
      },
      color: settings.color,
      format: settings.format,
      filenameMode: settings.filenameMode,
      sizeMode: settings.sizeMode,
      sizeValue: settings.sizeValue,
      marginY: settings.marginY,
      zipMode,
      removeBg: settings.removeBg
    });

    if (remoteFile.blob) {
      triggerDownload(remoteFile.blob, remoteFile.filename || "bulk-square-results.zip");
      return;
    }

    try {
      const blob = await downloadBlobFromUrl(remoteFile.url, remoteFile.filename, remoteFile.downloadUrl);
      triggerDownload(blob, remoteFile.filename || "bulk-square-results.zip");
    } finally {
      if (remoteFile.url) await mediaSourceService.cleanupUrls([remoteFile.url]);
    }
  }

  async function downloadSeparate(settings, items) {
    const DOWNLOAD_TRIGGER_INTERVAL_MS = 180;
    const total = items.length;
    const maxWorkers = Math.max(1, Math.min(DOWNLOAD_PARALLEL_REQUESTS, total));
    const readyResults = new Array(total);
    let completed = 0;
    statusView.setStatus(t("toastPreparingFiles", { current: 0, total }));

    const runOne = async (index) => {
      const result = await api.createSingleDownload({
        source: await mediaSourceService.ensureSource(items[index], settings),
        color: settings.color,
        format: settings.format,
        filenameMode: settings.filenameMode,
        sizeMode: settings.sizeMode,
        sizeValue: settings.sizeValue,
        marginY: settings.marginY,
        order: index + 1,
        orderTotal: total,
        removeBg: settings.removeBg
      });

      readyResults[index] = result;

      completed += 1;
      statusView.setStatus(t("toastPreparingFiles", { current: completed, total }));
    };

    const workers = Array.from({ length: maxWorkers }, (_unused, workerIndex) => (async () => {
      for (let index = workerIndex; index < total; index += maxWorkers) {
        await runOne(index);
      }
    })());

    await Promise.all(workers);

    statusView.setStatus(t("toastStartingDownload", { current: 0, total }));
    let triggered = 0;
    for (let index = total - 1; index >= 0; index -= 1) {
      const ready = readyResults[index];
      if (!ready) {
        throw new Error(t("toastMissingResults"));
      }

      const filename = ready.filename || computeFallbackFilename(
        items[index].file,
        settings.format,
        settings.filenameMode,
        index + 1,
        total,
        settings.marginY
      );
      try {
        const blob = ready.blob || await downloadBlobFromUrl(ready.url, filename, ready.downloadUrl);
        triggerDownload(blob, filename);
        triggered += 1;
        statusView.setStatus(t("toastStartingDownload", { current: triggered, total }));
      } finally {
        if (ready.url) await mediaSourceService.cleanupUrls([ready.url]);
      }

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

    ui.folderSelectBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      ui.folderInput.click();
    });

    ui.fileInput.addEventListener("change", () => {
      addFiles(ui.fileInput.files);
      ui.fileInput.value = "";
    });

    ui.folderInput.addEventListener("change", () => {
      addFiles(ui.folderInput.files);
      ui.folderInput.value = "";
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

    ui.dropzone.addEventListener("drop", async (event) => {
      const dt = event.dataTransfer;
      const files = await collectDroppedFiles(dt);
      addFiles(files);
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
      void cleanAll();
    });

    if (ui.languageSelect) {
      ui.languageSelect.value = i18n.getLanguage();
      ui.languageSelect.addEventListener("change", () => {
        const nextLanguage = i18n.setLanguage(ui.languageSelect.value);
        localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
        applyTranslations();
      });
    }

    const runDownload = async ({ selectedOnly }) => {
      const allItems = store.getItems();
      const targetItems = selectedOnly ? store.getSelectedItems() : allItems;
      if (!targetItems.length) return;

      ui.processBtn.disabled = true;
      ui.downloadSelectedBtn.disabled = true;
      statusView.setStatus(selectedOnly ? t("toastDownloadingSelection") : t("toastDownloading"));

      try {
        const settings = getSettingsOrThrow();

        if (settings.downloadMode === "zip") {
          await downloadZip(settings, "zip", targetItems);
          statusView.setStatus(t("toastZipReady"), "ok");
        } else if (settings.downloadMode === "folder") {
          await downloadZip(settings, "folder", targetItems);
          statusView.setStatus(t("toastFolderZipReady"), "ok");
        } else {
          await downloadSeparate(settings, targetItems);
          statusView.setStatus(t("toastDownloadStarted"), "ok");
        }

        if (!selectedOnly && settings.shouldAutoClean) await cleanAll({ silent: true });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        statusView.setStatus(error && error.message ? error.message : t("toastDownloadError"), "error");
      } finally {
        refreshCounters();
      }
    };

    ui.processBtn.addEventListener("click", async () => runDownload({ selectedOnly: false }));
    ui.downloadSelectedBtn.addEventListener("click", async () => runDownload({ selectedOnly: true }));
  }

  setupCustomSelects();
  initTheme();
  applyTranslations();
  bindDropzone();
  bindFormEvents();
  lockSettingsGroups();
  updatePaddingUIState();
  updateSizeModeUi();
  refreshUi();
  previewController.scheduleUpdate();
  scheduleThumbsUpdate();
})();
