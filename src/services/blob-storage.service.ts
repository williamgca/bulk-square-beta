import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { del, get, list, put } from "@vercel/blob";
import { BLOB_STORAGE_REQUESTED, MEDIA_STORAGE_MODE } from "../config/process";
import { HttpError } from "../errors/http-error";

interface UploadedDownloadBlob {
  url: string;
  filename: string;
}

interface PrivateBlobStreamResult {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  etag: string;
}

export interface BlobStorageAvailability {
  enabled: boolean;
  reason?: string;
}

const BLOB_AVAILABILITY_CACHE_TTL_MS = 60 * 1000;
const BLOB_AVAILABILITY_TIMEOUT_MS = 1500;
let availabilityCache: (BlobStorageAvailability & { checkedAt: number }) | null = null;
let availabilityPromise: Promise<BlobStorageAvailability> | null = null;

function normalizeBlobUrls(urls: string[]): string[] {
  return Array.from(
    new Set(
      urls
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function normalizeDownloadFilename(filename: string): string {
  return String(filename || "download.bin").replace(/[\r\n\u0000]/g, "") || "download.bin";
}

function sanitizeBlobPathFilename(filename: string): string {
  const trimmed = String(filename || "download.bin").trim();
  const normalized = trimmed
    .replace(/[\\/]+/g, "_")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "download.bin";
}

function createDownloadPathname(filename: string): string {
  const safeFilename = sanitizeBlobPathFilename(filename);
  return `bulk-square/downloads/${Date.now()}_${randomUUID()}/${safeFilename}`;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err || "Unknown Vercel Blob error.");
}

function createDisabledAvailability(reason: string): BlobStorageAvailability & { checkedAt: number } {
  return {
    enabled: false,
    reason,
    checkedAt: Date.now()
  };
}

async function probeBlobStorage(): Promise<BlobStorageAvailability & { checkedAt: number }> {
  if (!BLOB_STORAGE_REQUESTED) {
    const reason = MEDIA_STORAGE_MODE === "local"
      ? "Blob storage is disabled by MEDIA_STORAGE_MODE=local."
      : "Blob storage is not configured for this runtime.";
    return createDisabledAvailability(reason);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BLOB_AVAILABILITY_TIMEOUT_MS);

  try {
    await list({
      limit: 1,
      prefix: "bulk-square/",
      abortSignal: controller.signal
    });

    return {
      enabled: true,
      checkedAt: Date.now()
    };
  } catch (err) {
    const reason = getErrorMessage(err);
    // eslint-disable-next-line no-console
    console.warn("Vercel Blob storage is unavailable:", reason);
    return createDisabledAvailability(reason);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getBlobStorageAvailability(): Promise<BlobStorageAvailability> {
  if (availabilityCache && Date.now() - availabilityCache.checkedAt < BLOB_AVAILABILITY_CACHE_TTL_MS) {
    return {
      enabled: availabilityCache.enabled,
      reason: availabilityCache.reason
    };
  }

  if (!availabilityPromise) {
    availabilityPromise = probeBlobStorage()
      .then((status) => {
        availabilityCache = status;
        return {
          enabled: status.enabled,
          reason: status.reason
        };
      })
      .finally(() => {
        availabilityPromise = null;
      });
  }

  return availabilityPromise;
}

export function assertBlobConfigured(): void {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new HttpError("Vercel Blob is not configured. Missing BLOB_READ_WRITE_TOKEN.", 500);
  }
}

export async function downloadPrivateBlobToBuffer(blobUrl: string): Promise<Buffer> {
  assertBlobConfigured();

  const result = await get(blobUrl, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new HttpError("Uploaded image not found in Blob storage.", 404);
  }

  const arrayBuffer = await new Response(result.stream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function getPrivateBlobStream(blobUrl: string): Promise<PrivateBlobStreamResult> {
  assertBlobConfigured();

  const result = await get(blobUrl, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new HttpError("Blob not found in storage.", 404);
  }

  return {
    stream: result.stream,
    contentType: result.blob.contentType,
    etag: result.blob.etag
  };
}

export async function deleteBlobUrls(urls: string[]): Promise<number> {
  assertBlobConfigured();

  const normalized = normalizeBlobUrls(urls);
  if (!normalized.length) return 0;

  await del(normalized);
  return normalized.length;
}

export async function uploadPrivateDownloadBuffer(
  filename: string,
  body: Buffer,
  contentType: string
): Promise<UploadedDownloadBlob> {
  assertBlobConfigured();

  const downloadFilename = normalizeDownloadFilename(filename);
  const blob = await put(createDownloadPathname(downloadFilename), body, {
    access: "private",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    contentType
  });

  return {
    url: blob.url,
    filename: downloadFilename
  };
}

export function createPrivateDownloadUploadStream(filename: string, contentType: string): {
  stream: PassThrough;
  upload: Promise<UploadedDownloadBlob>;
} {
  assertBlobConfigured();

  const downloadFilename = normalizeDownloadFilename(filename);
  const stream = new PassThrough();
  const upload = put(createDownloadPathname(downloadFilename), stream, {
    access: "private",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    contentType
  }).then((blob) => ({
    url: blob.url,
    filename: downloadFilename
  }));

  return { stream, upload };
}
