import { createBlobUploadService } from "./blob-upload.js";

function isBlobStorageUnavailableError(error) {
  const message = String((error && error.message) || error || "").toLowerCase();
  return [
    "store is disabled",
    "store is disable",
    "store disabled",
    "store suspended",
    "blobstoresuspended",
    "blob store not found",
    "blobstorenotfound",
    "blob storage is unavailable",
    "vercel blob is not configured",
    "missing blob_read_write_token",
    "supabase storage is not configured",
    "supabase storage is unavailable",
    "storage bucket not found",
    "bucket not found"
  ].some((fragment) => message.includes(fragment));
}

export function createMediaSourceService({ blobStorageEnabled, storageProvider = "supabase", getEffectiveFile }) {
  const blobUploadService = blobStorageEnabled
    ? createBlobUploadService({ getEffectiveFile, storageProvider })
    : null;
  let blobStorageUnavailable = false;

  async function createLocalSource(item, settings) {
    const file = await getEffectiveFile(item, settings);
    return {
      file,
      originalName: item.file && item.file.name ? item.file.name : file.name
    };
  }

  async function ensureSource(item, settings) {
    if (blobUploadService && !blobStorageUnavailable) {
      try {
        return await blobUploadService.ensureSourceUpload(item, settings);
      } catch (error) {
        if (!isBlobStorageUnavailableError(error)) throw error;

        blobStorageUnavailable = true;
        // eslint-disable-next-line no-console
        console.warn("Remote storage is unavailable; falling back to direct uploads.", error);
      }
    }

    return createLocalSource(item, settings);
  }

  async function cleanupItems(items) {
    if (!blobUploadService) return 0;

    try {
      return await blobUploadService.cleanupItems(items);
    } catch (error) {
      if (!isBlobStorageUnavailableError(error)) throw error;
      blobStorageUnavailable = true;
      return 0;
    }
  }

  async function cleanupUrls(urls) {
    if (!blobUploadService) return 0;

    try {
      return await blobUploadService.cleanupUrls(urls);
    } catch (error) {
      if (!isBlobStorageUnavailableError(error)) throw error;
      blobStorageUnavailable = true;
      return 0;
    }
  }

  return {
    ensureSource,
    cleanupItems,
    cleanupUrls,
    get usesBlobStorage() {
      return !!blobUploadService && !blobStorageUnavailable;
    }
  };
}
