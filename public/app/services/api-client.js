import { parseFilenameFromContentDisposition } from "../utils/file.js";

function createCommonPayload({ color, format, filenameMode, sizeMode, sizeValue, marginY, removeBg }) {
  const payload = {
    color,
    format,
    filenameMode: filenameMode === "original" ? "original" : "processed",
    sizeMode,
    margin: String(marginY || 0),
    removeBg: removeBg ? "1" : "0"
  };

  if (sizeMode === "fixed") payload.size = String(sizeValue);
  return payload;
}

function appendPayload(formData, payload) {
  Object.entries(payload).forEach(([key, value]) => {
    formData.append(key, String(value));
  });
}

function hasLocalFile(source) {
  return source && source.file instanceof Blob;
}

function createOrderedFilename(source, index) {
  return `__o${index + 1}__${source.originalName || (source.file && source.file.name) || "image"}`;
}

function createSingleFormData(source, params) {
  const formData = new FormData();
  appendPayload(formData, createCommonPayload(params));
  formData.append("order", String(params.order));
  formData.append("orderTotal", String(params.orderTotal));
  formData.append("image", source.file, source.originalName || source.file.name || "image");
  return formData;
}

async function readBinaryResponse(response) {
  if (!response.ok) throw new Error(await extractError(response));

  const blob = await response.blob();
  const filename = parseFilenameFromContentDisposition(response.headers.get("content-disposition") || "");
  return { blob, filename };
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
  async function createZipDownload({ items, getProcessSource, onItemStart, color, format, filenameMode, sizeMode, sizeValue, marginY, zipMode, removeBg }) {
    const sources = [];

    for (let index = 0; index < items.length; index++) {
      if (onItemStart) onItemStart(index, items.length);
      sources.push(await getProcessSource(items[index], { removeBg }));
    }

    const commonPayload = createCommonPayload({ color, format, filenameMode, sizeMode, sizeValue, marginY, removeBg });

    if (sources.some(hasLocalFile)) {
      const formData = new FormData();
      appendPayload(formData, commonPayload);
      formData.append("downloadMode", zipMode);

      sources.forEach((source, index) => {
        formData.append("images", source.file, createOrderedFilename(source, index));
      });

      const response = await fetch("/api/process", {
        method: "POST",
        body: formData
      });
      return readBinaryResponse(response);
    }

    const payloadItems = sources.map((source) => ({
      blobUrl: source.url,
      originalName: source.originalName
    }));

    const response = await fetch("/api/process", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...commonPayload,
        downloadMode: zipMode,
        responseMode: "blob",
        items: payloadItems
      })
    });
    if (!response.ok) throw new Error(await extractError(response));
    return response.json();
  }

  async function fetchSingle({ source, color, format, filenameMode, sizeMode, sizeValue, marginY, order, orderTotal, removeBg }) {
    const params = { color, format, filenameMode, sizeMode, sizeValue, marginY, order, orderTotal, removeBg };
    if (hasLocalFile(source)) {
      const response = await fetch("/api/process-single", {
        method: "POST",
        body: createSingleFormData(source, params)
      });
      return readBinaryResponse(response);
    }

    const response = await fetch("/api/process-single", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...createCommonPayload({ color, format, filenameMode, sizeMode, sizeValue, marginY, removeBg }),
        blobUrl: source.url,
        originalName: source.originalName,
        order: String(order),
        orderTotal: String(orderTotal)
      })
    });
    return readBinaryResponse(response);
  }

  async function createSingleDownload({ source, color, format, filenameMode, sizeMode, sizeValue, marginY, order, orderTotal, removeBg }) {
    const params = { color, format, filenameMode, sizeMode, sizeValue, marginY, order, orderTotal, removeBg };
    if (hasLocalFile(source)) {
      const response = await fetch("/api/process-single", {
        method: "POST",
        body: createSingleFormData(source, params)
      });
      return readBinaryResponse(response);
    }

    const response = await fetch("/api/process-single", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...createCommonPayload({ color, format, filenameMode, sizeMode, sizeValue, marginY, removeBg }),
        responseMode: "blob",
        blobUrl: source.url,
        originalName: source.originalName,
        order: String(order),
        orderTotal: String(orderTotal)
      })
    });
    if (!response.ok) throw new Error(await extractError(response));
    return response.json();
  }

  return {
    createSingleDownload,
    createZipDownload,
    fetchSingle
  };
}
