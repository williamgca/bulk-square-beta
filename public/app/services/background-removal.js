import { sanitizeBaseName } from "../utils/file.js";

export function createBackgroundRemovalService() {
  let modulePromise = null;

  async function getRemoveBackgroundFn() {
    if (!modulePromise) {
      modulePromise = import("@imgly/background-removal");
    }

    try {
      const mod = await modulePromise;
      const fn = mod.default || mod.removeBackground;
      if (typeof fn !== "function") throw new Error("removeBackground export not found");
      return fn;
    } catch {
      modulePromise = null;
      throw new Error("No se pudo cargar el motor de remover background.");
    }
  }

  async function getEffectiveFile(item, settings) {
    if (!settings || !settings.removeBg) return item.file;
    if (item.removeBgFile instanceof File) return item.removeBgFile;

    const removeBackground = await getRemoveBackgroundFn();
    const resultBlob = await removeBackground(item.file, {
      output: {
        format: "image/png",
        quality: 1,
        type: "foreground"
      }
    });

    const baseName = sanitizeBaseName(item.file.name || "image");
    item.removeBgFile = new File([resultBlob], `${baseName}_nobg.png`, { type: "image/png" });
    return item.removeBgFile;
  }

  return {
    getEffectiveFile
  };
}
