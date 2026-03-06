import { parseFilenameFromContentDisposition } from "../utils/file.js";

function appendCommonFields(formData, { color, format, sizeMode, sizeValue, marginY, removeBg }) {
  formData.append("color", color);
  formData.append("format", format);
  formData.append("sizeMode", sizeMode);
  if (sizeMode === "fixed") formData.append("size", String(sizeValue));
  formData.append("margin", String(marginY || 0));
  formData.append("removeBg", removeBg ? "1" : "0");
}

async function extractError(response) {
  let message = `Error ${response.status}`;
  try {
    const data = await response.json();
    if (data && data.error) message = data.error;
  } catch {
    // ignore
  }

  return message;
}

export function createProcessApi() {
  async function fetchZip({ items, getEffectiveFile, onItemStart, color, format, sizeMode, sizeValue, marginY, zipMode, removeBg }) {
    const formData = new FormData();
    const padLen = String(items.length).length;

    for (let index = 0; index < items.length; index++) {
      if (onItemStart) onItemStart(index, items.length);
      const item = items[index];
      const prefix = String(index + 1).padStart(padLen, "0");
      const fileForUpload = await getEffectiveFile(item, { removeBg });
      formData.append("images", fileForUpload, `__o${prefix}__${fileForUpload.name}`);
    }

    appendCommonFields(formData, { color, format, sizeMode, sizeValue, marginY, removeBg });
    formData.append("downloadMode", zipMode);

    const response = await fetch("/api/process", { method: "POST", body: formData });
    if (!response.ok) throw new Error(await extractError(response));
    return response.blob();
  }

  async function fetchSingle({ file, color, format, sizeMode, sizeValue, marginY, order, orderTotal, removeBg }) {
    const formData = new FormData();
    formData.append("image", file, file.name);
    appendCommonFields(formData, { color, format, sizeMode, sizeValue, marginY, removeBg });
    formData.append("order", String(order));
    formData.append("orderTotal", String(orderTotal));

    const response = await fetch("/api/process-single", { method: "POST", body: formData });
    if (!response.ok) throw new Error(await extractError(response));

    const blob = await response.blob();
    const filename = parseFilenameFromContentDisposition(response.headers.get("content-disposition") || "");
    return { blob, filename };
  }

  return {
    fetchZip,
    fetchSingle
  };
}
