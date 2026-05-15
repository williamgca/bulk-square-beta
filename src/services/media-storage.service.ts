import { PassThrough } from "node:stream";
import { BLOB_STORAGE_REQUESTED, MEDIA_STORAGE_MODE, SUPABASE_STORAGE_REQUESTED } from "../config/process";
import { HttpError } from "../errors/http-error";
import {
  createPrivateDownloadUploadStream,
  deleteBlobUrls,
  downloadPrivateBlobToBuffer,
  getBlobStorageAvailability,
  getPrivateBlobStream,
  uploadPrivateDownloadBuffer
} from "./blob-storage.service";
import {
  createSupabaseDownloadUploadStream,
  createSupabaseSignedUpload,
  deleteSupabaseObjects,
  downloadSupabaseObjectToBuffer,
  getSupabaseObject,
  getSupabaseStorageAvailability,
  uploadSupabaseDownloadBuffer
} from "./supabase-storage.service";

export type RemoteStorageProvider = "supabase" | "vercel-blob" | "local";

export interface RemoteStorageAvailability {
  enabled: boolean;
  provider: RemoteStorageProvider;
  reason?: string;
}

export interface RemoteUploadToken {
  provider: "supabase";
  bucket: string;
  path: string;
  url: string;
  signedUrl: string;
  token: string;
}

export interface RemoteDownloadObject {
  url: string;
  filename: string;
  downloadUrl?: string;
}

export interface RemoteObjectPayload {
  body: Buffer;
  contentType: string;
  etag?: string;
}

export function getRemoteStorageProvider(): RemoteStorageProvider {
  if (SUPABASE_STORAGE_REQUESTED) return "supabase";
  if (BLOB_STORAGE_REQUESTED) return "vercel-blob";
  return "local";
}

export async function getRemoteStorageAvailability(): Promise<RemoteStorageAvailability> {
  const provider = getRemoteStorageProvider();

  if (provider === "supabase") {
    const status = await getSupabaseStorageAvailability();
    return { ...status, provider };
  }

  if (provider === "vercel-blob") {
    const status = await getBlobStorageAvailability();
    return { ...status, provider };
  }

  return {
    enabled: false,
    provider,
    reason: MEDIA_STORAGE_MODE === "local"
      ? "Remote storage is disabled by MEDIA_STORAGE_MODE=local."
      : "Remote storage is not configured for this runtime."
  };
}

export async function createRemoteUploadToken(path: string): Promise<RemoteUploadToken> {
  const provider = getRemoteStorageProvider();
  if (provider === "supabase") return createSupabaseSignedUpload(path);

  throw new HttpError(`Client upload tokens are not supported for storage provider ${provider}.`, 500);
}

export async function downloadRemoteObjectToBuffer(reference: string): Promise<Buffer> {
  const provider = getRemoteStorageProvider();
  if (provider === "supabase") return downloadSupabaseObjectToBuffer(reference);
  if (provider === "vercel-blob") return downloadPrivateBlobToBuffer(reference);

  throw new HttpError("Remote storage is not enabled.", 500);
}

export async function getRemoteObject(reference: string): Promise<RemoteObjectPayload> {
  const provider = getRemoteStorageProvider();
  if (provider === "supabase") return getSupabaseObject(reference);

  if (provider === "vercel-blob") {
    const blob = await getPrivateBlobStream(reference);
    const arrayBuffer = await new Response(blob.stream).arrayBuffer();
    return {
      body: Buffer.from(arrayBuffer),
      contentType: blob.contentType,
      etag: blob.etag
    };
  }

  throw new HttpError("Remote storage is not enabled.", 500);
}

export async function deleteRemoteObjects(references: string[]): Promise<number> {
  const provider = getRemoteStorageProvider();
  if (provider === "supabase") return deleteSupabaseObjects(references);
  if (provider === "vercel-blob") return deleteBlobUrls(references);
  return 0;
}

export async function uploadRemoteDownloadBuffer(
  filename: string,
  body: Buffer,
  contentType: string
): Promise<RemoteDownloadObject> {
  const provider = getRemoteStorageProvider();
  if (provider === "supabase") return uploadSupabaseDownloadBuffer(filename, body, contentType);
  if (provider === "vercel-blob") return uploadPrivateDownloadBuffer(filename, body, contentType);

  throw new HttpError("Remote storage is not enabled.", 500);
}

export function createRemoteDownloadUploadStream(filename: string, contentType: string): {
  stream: PassThrough;
  upload: Promise<RemoteDownloadObject>;
} {
  const provider = getRemoteStorageProvider();
  if (provider === "supabase") return createSupabaseDownloadUploadStream(filename, contentType);
  if (provider === "vercel-blob") return createPrivateDownloadUploadStream(filename, contentType);

  throw new HttpError("Remote storage is not enabled.", 500);
}
