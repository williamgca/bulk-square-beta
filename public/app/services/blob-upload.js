import { MULTIPART_UPLOAD_THRESHOLD_BYTES } from "../config.js";
import { sanitizeBaseName } from "../utils/file.js";

let uploadPromise = null;

async function getUploadFn() {
  if (!uploadPromise) {
    uploadPromise = import("/vendor/vercel-blob/client.js")
      .then((mod) => {
        if (typeof mod.upload !== "function") {
          throw new Error("Vercel Blob client upload is unavailable.");
        }
        return mod.upload;
      })
      .catch((error) => {
        uploadPromise = null;
        throw error;
      });
  }

  return uploadPromise;
}

function getExtension(filename) {
  const match = /\.[^./\\]+$/.exec(String(filename || ""));
  return match ? match[0].toLowerCase() : "";
}

function buildBlobPathname(file, itemId, variant) {
  const baseName = sanitizeBaseName(file && file.name ? file.name : "image");
  const ext = getExtension(file && file.name ? file.name : "");
  return `bulk-square/uploads/${variant}/${itemId}_${baseName}${ext}`;
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

function normalizeCleanupUrls(urls) {
  return Array.from(new Set(
    (Array.isArray(urls) ? urls : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function getUploadKeys(settings) {
  if (settings && settings.removeBg) {
    return {
      uploadKey: "removeBgUpload",
      promiseKey: "removeBgUploadPromise",
      variant: "remove-bg"
    };
  }

  return {
    uploadKey: "sourceUpload",
    promiseKey: "sourceUploadPromise",
    variant: "source"
  };
}

function getItemCleanupUrls(item) {
  return [item.sourceUpload && item.sourceUpload.url, item.removeBgUpload && item.removeBgUpload.url].filter(Boolean);
}

async function waitForPendingUploads(items) {
  const pending = [];

  for (const item of items) {
    if (item && item.sourceUploadPromise) pending.push(item.sourceUploadPromise);
    if (item && item.removeBgUploadPromise) pending.push(item.removeBgUploadPromise);
  }

  if (!pending.length) return;
  await Promise.allSettled(pending);
}

export function createBlobUploadService({ getEffectiveFile }) {
  async function ensureSourceUpload(item, settings) {
    const { uploadKey, promiseKey, variant } = getUploadKeys(settings);
    if (item[uploadKey] && item[uploadKey].url) return item[uploadKey];
    if (item[promiseKey]) return item[promiseKey];

    item[promiseKey] = (async () => {
      const upload = await getUploadFn();
      const file = await getEffectiveFile(item, settings);
      const blob = await upload(buildBlobPathname(file, item.id, variant), file, {
        access: "private",
        handleUploadUrl: "/api/blob/upload",
        multipart: file.size >= MULTIPART_UPLOAD_THRESHOLD_BYTES
      });

      const uploadedSource = {
        url: blob.url,
        pathname: blob.pathname,
        originalName: file.name,
        contentType: blob.contentType
      };

      item[uploadKey] = uploadedSource;
      return uploadedSource;
    })().finally(() => {
      item[promiseKey] = null;
    });

    return item[promiseKey];
  }

  async function cleanupItems(items) {
    const snapshot = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!snapshot.length) return 0;

    await waitForPendingUploads(snapshot);

    const urls = normalizeCleanupUrls(snapshot.flatMap((item) => getItemCleanupUrls(item)));

    if (!urls.length) return 0;

    return cleanupUrls(urls);
  }

  async function cleanupUrls(urls) {
    const normalized = normalizeCleanupUrls(urls);
    if (!normalized.length) return 0;

    const response = await fetch("/api/blob/cleanup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ urls: normalized })
    });

    if (!response.ok) {
      throw new Error(await extractError(response));
    }
    return normalized.length;
  }

  return {
    ensureSourceUpload,
    cleanupItems,
    cleanupUrls
  };
}
