import { MAX_FILES_PER_BATCH } from "../config.js";

const COMPATIBLE_IMAGE_EXTENSION_RE = /\.(avif|bmp|gif|heic|heif|jpeg|jpg|png|svg|tif|tiff|webp)$/i;

function createUidGenerator() {
  let seq = 0;

  return function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    seq += 1;
    return `id_${Date.now()}_${seq}`;
  };
}

function isCompatibleImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith("image/")) return true;
  return COMPATIBLE_IMAGE_EXTENSION_RE.test(file.name || "");
}

export function createItemsStore() {
  const uid = createUidGenerator();
  let items = [];

  function getItems() {
    return items;
  }

  function addFiles(fileList, { maxFiles = MAX_FILES_PER_BATCH } = {}) {
    const candidates = Array.from(fileList || []).filter(Boolean);
    const compatible = candidates.filter(isCompatibleImageFile);
    const remainingSlots = Math.max(0, maxFiles - items.length);
    const incoming = compatible.slice(0, remainingSlots);

    const mapped = incoming.map((file) => ({
      id: uid(),
      file,
      url: URL.createObjectURL(file),
      removeBgFile: null,
      sourceUpload: null,
      sourceUploadPromise: null,
      removeBgUpload: null,
      removeBgUploadPromise: null,
      processedThumbUrl: null,
      processedThumbKey: null,
      selected: false
    }));

    items = items.concat(mapped);
    return {
      added: mapped.length,
      skippedUnsupported: candidates.length - compatible.length,
      skippedLimit: Math.max(0, compatible.length - incoming.length)
    };
  }

  function removeAt(index) {
    if (index < 0 || index >= items.length) return false;

    const [item] = items.splice(index, 1);
    try {
      URL.revokeObjectURL(item.url);
    } catch {
      // ignore
    }
    try {
      if (item.processedThumbUrl) URL.revokeObjectURL(item.processedThumbUrl);
    } catch {
      // ignore
    }

    return true;
  }

  function moveItem(from, to) {
    if (from < 0 || from >= items.length) return false;
    if (to < 0 || to >= items.length) return false;
    if (from === to) return false;

    const copy = items.slice();
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    items = copy;
    return true;
  }

  function clear() {
    for (const item of items) {
      try {
        URL.revokeObjectURL(item.url);
      } catch {
        // ignore
      }
      try {
        if (item.processedThumbUrl) URL.revokeObjectURL(item.processedThumbUrl);
      } catch {
        // ignore
      }
    }

    items = [];
  }

  function toggleSelect(index) {
    if (index < 0 || index >= items.length) return false;
    items[index].selected = !items[index].selected;
    return true;
  }

  function clearSelection() {
    for (const item of items) item.selected = false;
  }

  function selectedCount() {
    return items.reduce((acc, item) => acc + (item.selected ? 1 : 0), 0);
  }

  function getSelectedItems() {
    return items.filter((item) => item.selected);
  }

  function totalBytes() {
    return items.reduce((acc, item) => acc + (item.file ? item.file.size : 0), 0);
  }

  return {
    getItems,
    addFiles,
    removeAt,
    moveItem,
    clear,
    totalBytes,
    toggleSelect,
    clearSelection,
    selectedCount,
    getSelectedItems
  };
}
