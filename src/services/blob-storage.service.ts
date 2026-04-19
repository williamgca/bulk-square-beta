import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { del, get, put } from "@vercel/blob";
import { HttpError } from "../errors/http-error";

interface UploadedDownloadBlob {
  url: string;
  downloadUrl: string;
  filename: string;
}

function normalizeBlobUrls(urls: string[]): string[] {
  return Array.from(
    new Set(
      urls
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function sanitizeDownloadFilename(filename: string): string {
  const trimmed = String(filename || "download.bin").trim();
  const normalized = trimmed
    .replace(/[\\/]+/g, "_")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "download.bin";
}

function createDownloadPathname(filename: string): string {
  const safeFilename = sanitizeDownloadFilename(filename);
  return `bulk-square/downloads/${Date.now()}_${randomUUID()}/${safeFilename}`;
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

export async function deleteBlobUrls(urls: string[]): Promise<number> {
  assertBlobConfigured();

  const normalized = normalizeBlobUrls(urls);
  if (!normalized.length) return 0;

  await del(normalized);
  return normalized.length;
}

export async function uploadPublicDownloadBuffer(
  filename: string,
  body: Buffer,
  contentType: string
): Promise<UploadedDownloadBlob> {
  assertBlobConfigured();

  const safeFilename = sanitizeDownloadFilename(filename);
  const blob = await put(createDownloadPathname(safeFilename), body, {
    access: "public",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    contentType
  });

  return {
    url: blob.url,
    downloadUrl: blob.downloadUrl,
    filename: safeFilename
  };
}

export function createPublicDownloadUploadStream(filename: string, contentType: string): {
  stream: PassThrough;
  upload: Promise<UploadedDownloadBlob>;
} {
  assertBlobConfigured();

  const safeFilename = sanitizeDownloadFilename(filename);
  const stream = new PassThrough();
  const upload = put(createDownloadPathname(safeFilename), stream, {
    access: "public",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    contentType
  }).then((blob) => ({
    url: blob.url,
    downloadUrl: blob.downloadUrl,
    filename: safeFilename
  }));

  return { stream, upload };
}
