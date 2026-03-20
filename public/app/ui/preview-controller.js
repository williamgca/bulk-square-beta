import { PREVIEW_DEBOUNCE_MS } from "../config.js";

export function createPreviewController({
  previewCard,
  previewWrap,
  previewImg,
  previewPlaceholder,
  getItems,
  getSettingsOrThrow,
  getEffectiveFile,
  fetchSingle,
  t
}) {
  if (!previewCard) {
    return {
      scheduleUpdate() {},
      reset() {}
    };
  }

  let previewTimer = null;
  let previewSeq = 0;
  let previewUrl = null;
  let lastPreviewKey = null;

  function makeSettingsKey(settings) {
    return [
      settings.color,
      settings.format,
      settings.sizeMode,
      String(settings.sizeValue || ""),
      String(settings.marginY || 0),
      settings.removeBg ? "1" : "0"
    ].join("|");
  }

  function setPreviewState({ text, hasImage }) {
    if (hasImage) previewWrap.classList.add("has-image");
    else previewWrap.classList.remove("has-image");

    if (typeof text === "string") previewPlaceholder.textContent = text;
  }

  function reset() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }

    previewImg.removeAttribute("src");
    lastPreviewKey = null;
    setPreviewState({ text: t("previewEmpty"), hasImage: false });
  }

  async function updatePreview() {
    previewSeq += 1;
    const seq = previewSeq;
    const items = getItems();

    if (!items.length) {
      reset();
      return;
    }

    let settings;
    try {
      settings = getSettingsOrThrow();
    } catch (error) {
      setPreviewState({ text: error && error.message ? error.message : t("previewInvalidSettings"), hasImage: false });
      return;
    }

    const firstItem = items[0];
    const previewKey = `${firstItem.id}|${makeSettingsKey(settings)}`;
    if (previewUrl && lastPreviewKey === previewKey) return;

    setPreviewState({ text: t("previewGenerating"), hasImage: false });

    try {
      const previewFile = settings.removeBg
        ? await (async () => {
          setPreviewState({ text: t("previewRemovingBg"), hasImage: false });
          return getEffectiveFile(firstItem, settings);
        })()
        : firstItem.file;

      const { blob } = await fetchSingle({
        file: previewFile,
        color: settings.color,
        format: settings.format,
        sizeMode: settings.sizeMode,
        sizeValue: settings.sizeValue,
        marginY: settings.marginY,
        order: 1,
        orderTotal: items.length,
        removeBg: settings.removeBg
      });

      if (seq !== previewSeq) return;

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      previewImg.src = previewUrl;
      lastPreviewKey = previewKey;
      setPreviewState({ text: "", hasImage: true });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      setPreviewState({ text: t("previewFailed"), hasImage: false });
    }
  }

  function scheduleUpdate() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      updatePreview();
    }, PREVIEW_DEBOUNCE_MS);
  }

  return {
    scheduleUpdate,
    reset
  };
}
