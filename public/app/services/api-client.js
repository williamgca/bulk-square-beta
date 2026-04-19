import { parseFilenameFromContentDisposition } from "../utils/file.js";

function createCommonPayload({ color, format, sizeMode, sizeValue, marginY, removeBg }) {
  const payload = {
    color,
    format,
    sizeMode,
    margin: String(marginY || 0),
    removeBg: removeBg ? "1" : "0"
  };

  if (sizeMode === "fixed") payload.size = String(sizeValue);
  return payload;
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
  async function createZipDownload({ items, getProcessSource, onItemStart, color, format, sizeMode, sizeValue, marginY, zipMode, removeBg }) {
    const payloadItems = [];

    for (let index = 0; index < items.length; index++) {
      if (onItemStart) onItemStart(index, items.length);
      const source = await getProcessSource(items[index], { removeBg });
      payloadItems.push({
        blobUrl: source.url,
        originalName: source.originalName
      });
    }

    const response = await fetch("/api/process", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...createCommonPayload({ color, format, sizeMode, sizeValue, marginY, removeBg }),
        downloadMode: zipMode,
        responseMode: "blob",
        items: payloadItems
      })
    });
    if (!response.ok) throw new Error(await extractError(response));
    return response.json();
  }

  async function fetchSingle({ source, color, format, sizeMode, sizeValue, marginY, order, orderTotal, removeBg }) {
    const response = await fetch("/api/process-single", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...createCommonPayload({ color, format, sizeMode, sizeValue, marginY, removeBg }),
        blobUrl: source.url,
        originalName: source.originalName,
        order: String(order),
        orderTotal: String(orderTotal)
      })
    });
    if (!response.ok) throw new Error(await extractError(response));

    const blob = await response.blob();
    const filename = parseFilenameFromContentDisposition(response.headers.get("content-disposition") || "");
    return { blob, filename };
  }

  async function createSingleDownload({ source, color, format, sizeMode, sizeValue, marginY, order, orderTotal, removeBg }) {
    const response = await fetch("/api/process-single", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...createCommonPayload({ color, format, sizeMode, sizeValue, marginY, removeBg }),
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
