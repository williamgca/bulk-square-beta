import { MAX_FILES_PER_BATCH } from "../config.js";

export async function fetchRuntimeConfig() {
  try {
    const response = await fetch("/api/runtime-config", {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Runtime config failed: ${response.status}`);

    const data = await response.json();
    return {
      blobStorageEnabled: !!data.blobStorageEnabled,
      blobStorageReason: data.blobStorageReason ? String(data.blobStorageReason) : "",
      storageProvider: data.storageProvider ? String(data.storageProvider) : "local",
      maxFilesPerBatch: Number(data.maxFilesPerBatch) || MAX_FILES_PER_BATCH
    };
  } catch {
    return {
      blobStorageEnabled: false,
      blobStorageReason: "",
      storageProvider: "local",
      maxFilesPerBatch: MAX_FILES_PER_BATCH
    };
  }
}
