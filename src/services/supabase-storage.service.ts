import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_STORAGE_BUCKET,
  SUPABASE_STORAGE_REQUESTED,
  SUPABASE_URL
} from "../config/process";
import { HttpError } from "../errors/http-error";

interface UploadedStorageObject {
  url: string;
  filename: string;
  downloadUrl?: string;
}

interface PrivateStorageObject {
  body: Buffer;
  contentType: string;
  etag?: string;
}

export interface SupabaseStorageAvailability {
  enabled: boolean;
  reason?: string;
}

export interface SupabaseSignedUpload {
  provider: "supabase";
  bucket: string;
  path: string;
  url: string;
  signedUrl: string;
  token: string;
}

const SUPABASE_AVAILABILITY_CACHE_TTL_MS = 60 * 1000;
const SUPABASE_DOWNLOAD_URL_TTL_SECONDS = 10 * 60;
let supabaseClient: SupabaseClient | null = null;
let availabilityCache: (SupabaseStorageAvailability & { checkedAt: number }) | null = null;
let availabilityPromise: Promise<SupabaseStorageAvailability> | null = null;

function getSupabaseClient(): SupabaseClient {
  assertSupabaseConfigured();

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return supabaseClient;
}

function getMissingSupabaseConfig(): string[] {
  const missing = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY");
  if (!SUPABASE_STORAGE_BUCKET) missing.push("SUPABASE_STORAGE_BUCKET");
  return missing;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err || "Unknown Supabase Storage error.");
}

function normalizeDownloadFilename(filename: string): string {
  return String(filename || "download.bin").replace(/[\r\n\u0000]/g, "") || "download.bin";
}

function sanitizeStoragePathFilename(filename: string): string {
  const trimmed = String(filename || "download.bin").trim();
  const normalized = trimmed
    .replace(/[\\/]+/g, "_")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "download.bin";
}

function createDownloadPath(filename: string): string {
  const safeFilename = sanitizeStoragePathFilename(filename);
  return `bulk-square/downloads/${Date.now()}_${randomUUID()}/${safeFilename}`;
}

function normalizeStoragePaths(paths: string[]): string[] {
  return Array.from(
    new Set(
      paths
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .map((value) => {
          try {
            const url = new URL(value);
            const marker = `/object/sign/${SUPABASE_STORAGE_BUCKET}/`;
            const markerIndex = url.pathname.indexOf(marker);
            if (markerIndex >= 0) {
              return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
            }
          } catch {
            // Plain storage paths are expected for this app.
          }

          return value.replace(/^\/+/, "");
        })
    )
  );
}

async function createSignedDownloadUrl(path: string, filename?: string): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .storage
    .from(SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(path, SUPABASE_DOWNLOAD_URL_TTL_SECONDS, {
      download: filename || true
    });

  if (error || !data?.signedUrl) {
    throw new HttpError(error?.message || "Could not create Supabase signed download URL.", 500);
  }

  return data.signedUrl;
}

export function assertSupabaseConfigured(): void {
  const missing = getMissingSupabaseConfig();
  if (missing.length) {
    throw new HttpError(`Supabase Storage is not configured. Missing ${missing.join(", ")}.`, 500);
  }
}

export async function getSupabaseStorageAvailability(): Promise<SupabaseStorageAvailability> {
  if (!SUPABASE_STORAGE_REQUESTED) {
    return {
      enabled: false,
      reason: "Supabase Storage is not selected for this runtime."
    };
  }

  const missing = getMissingSupabaseConfig();
  if (missing.length) {
    return {
      enabled: false,
      reason: `Supabase Storage is not configured. Missing ${missing.join(", ")}.`
    };
  }

  if (availabilityCache && Date.now() - availabilityCache.checkedAt < SUPABASE_AVAILABILITY_CACHE_TTL_MS) {
    return {
      enabled: availabilityCache.enabled,
      reason: availabilityCache.reason
    };
  }

  if (!availabilityPromise) {
    availabilityPromise = (async () => {
      const { error } = await getSupabaseClient()
        .storage
        .from(SUPABASE_STORAGE_BUCKET)
        .list("", { limit: 1 });

      const status = error
        ? {
          enabled: false,
          reason: error.message,
          checkedAt: Date.now()
        }
        : {
          enabled: true,
          checkedAt: Date.now()
        };

      if (!status.enabled) {
        // eslint-disable-next-line no-console
        console.warn("Supabase Storage is unavailable:", status.reason);
      }

      availabilityCache = status;
      return {
        enabled: status.enabled,
        reason: status.reason
      };
    })().catch((err) => {
      const reason = getErrorMessage(err);
      availabilityCache = {
        enabled: false,
        reason,
        checkedAt: Date.now()
      };
      // eslint-disable-next-line no-console
      console.warn("Supabase Storage is unavailable:", reason);
      return {
        enabled: false,
        reason
      };
    }).finally(() => {
      availabilityPromise = null;
    });
  }

  return availabilityPromise;
}

export async function createSupabaseSignedUpload(path: string): Promise<SupabaseSignedUpload> {
  assertSupabaseConfigured();

  const { data, error } = await getSupabaseClient()
    .storage
    .from(SUPABASE_STORAGE_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data?.signedUrl || !data.token) {
    throw new HttpError(error?.message || "Could not create Supabase signed upload URL.", 500);
  }

  return {
    provider: "supabase",
    bucket: SUPABASE_STORAGE_BUCKET,
    path: data.path,
    url: data.path,
    signedUrl: data.signedUrl,
    token: data.token
  };
}

export async function downloadSupabaseObjectToBuffer(path: string): Promise<Buffer> {
  const object = await getSupabaseObject(path);
  return object.body;
}

export async function getSupabaseObject(path: string): Promise<PrivateStorageObject> {
  assertSupabaseConfigured();

  const { data, error } = await getSupabaseClient()
    .storage
    .from(SUPABASE_STORAGE_BUCKET)
    .download(path);

  if (error || !data) {
    throw new HttpError(error?.message || "Stored file not found in Supabase Storage.", 404);
  }

  const arrayBuffer = await data.arrayBuffer();
  return {
    body: Buffer.from(arrayBuffer),
    contentType: data.type || "application/octet-stream"
  };
}

export async function deleteSupabaseObjects(paths: string[]): Promise<number> {
  assertSupabaseConfigured();

  const normalized = normalizeStoragePaths(paths);
  if (!normalized.length) return 0;

  const { error } = await getSupabaseClient()
    .storage
    .from(SUPABASE_STORAGE_BUCKET)
    .remove(normalized);

  if (error) {
    throw new HttpError(error.message, 500);
  }

  return normalized.length;
}

export async function uploadSupabaseDownloadBuffer(
  filename: string,
  body: Buffer,
  contentType: string
): Promise<UploadedStorageObject> {
  assertSupabaseConfigured();

  const downloadFilename = normalizeDownloadFilename(filename);
  const path = createDownloadPath(downloadFilename);
  const { error } = await getSupabaseClient()
    .storage
    .from(SUPABASE_STORAGE_BUCKET)
    .upload(path, body, {
      cacheControl: "60",
      contentType,
      upsert: false
    });

  if (error) {
    throw new HttpError(error.message, 500);
  }

  return {
    url: path,
    filename: downloadFilename,
    downloadUrl: await createSignedDownloadUrl(path, downloadFilename)
  };
}

export function createSupabaseDownloadUploadStream(filename: string, contentType: string): {
  stream: PassThrough;
  upload: Promise<UploadedStorageObject>;
} {
  assertSupabaseConfigured();

  const downloadFilename = normalizeDownloadFilename(filename);
  const path = createDownloadPath(downloadFilename);
  const stream = new PassThrough();
  const upload = getSupabaseClient()
    .storage
    .from(SUPABASE_STORAGE_BUCKET)
    .upload(path, stream, {
      cacheControl: "60",
      contentType,
      upsert: false
    })
    .then(async ({ error }) => {
      if (error) {
        throw new HttpError(error.message, 500);
      }

      return {
        url: path,
        filename: downloadFilename,
        downloadUrl: await createSignedDownloadUrl(path, downloadFilename)
      };
    });

  return { stream, upload };
}
