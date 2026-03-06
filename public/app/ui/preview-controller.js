import { PREVIEW_DEBOUNCE_MS } from "../config.js";

export function createPreviewController({
  previewCard,
  previewWrap,
  previewImg,
  previewPlaceholder,
  getItems,
  getSettingsOrThrow,
  getEffectiveFile,
  fetchSingle
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
    setPreviewState({ text: "Sube imágenes para ver el preview.", hasImage: false });
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
      setPreviewState({ text: error && error.message ? error.message : "Ajustes inválidos.", hasImage: false });
      return;
    }

    setPreviewState({ text: "Generando preview...", hasImage: false });

    try {
      const previewFile = settings.removeBg
        ? await (async () => {
          setPreviewState({ text: "Removiendo fondo para preview...", hasImage: false });
          return getEffectiveFile(items[0], settings);
        })()
        : items[0].file;

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
      setPreviewState({ text: "", hasImage: true });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      setPreviewState({ text: "No se pudo generar el preview.", hasImage: false });
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
