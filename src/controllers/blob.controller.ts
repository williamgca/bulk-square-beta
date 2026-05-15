import { Readable } from "node:stream";
import { Request, Response } from "express";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { HttpError } from "../errors/http-error";
import { assertBlobConfigured } from "../services/blob-storage.service";
import {
  createRemoteUploadToken,
  deleteRemoteObjects,
  getRemoteObject,
  getRemoteStorageProvider
} from "../services/media-storage.service";
import { attachmentContentDisposition } from "../utils/http";

const BLOB_UPLOAD_PREFIX = "bulk-square/uploads/";
const MAX_BLOB_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
const CLIENT_TOKEN_TTL_MS = 10 * 60 * 1000;

function asBody(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object") return input as Record<string, unknown>;
  return {};
}

function respondError(err: unknown, res: Response): Response {
  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err instanceof Error) {
    return res.status(400).json({ error: err.message });
  }

  return res.status(500).json({ error: "Blob request failed." });
}

function parseCleanupUrls(body: Record<string, unknown>): string[] {
  const urls = body.urls;
  if (!Array.isArray(urls)) return [];

  return urls
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function validateUploadPathname(pathname: string): void {
  if (!pathname.startsWith(BLOB_UPLOAD_PREFIX)) {
    throw new HttpError("Invalid upload pathname.", 400);
  }
}

function parseSupabaseUploadPathname(body: Record<string, unknown>): string {
  const pathname = String(body.pathname || "").trim();
  if (!pathname) {
    throw new HttpError("Missing upload pathname.", 400);
  }

  validateUploadPathname(pathname);

  const contentType = String(body.contentType || "").trim().toLowerCase();
  if (contentType && !contentType.startsWith("image/")) {
    throw new HttpError("Invalid upload content type.", 400);
  }

  const size = Number(body.size);
  if (Number.isFinite(size) && size > MAX_BLOB_UPLOAD_SIZE_BYTES) {
    throw new HttpError("Image is too large.", 400);
  }

  return pathname;
}

export async function blobUploadController(req: Request, res: Response): Promise<Response> {
  try {
    if (getRemoteStorageProvider() === "supabase") {
      const pathname = parseSupabaseUploadPathname(asBody(req.body));
      const token = await createRemoteUploadToken(pathname);
      return res.status(200).json(token);
    }

    assertBlobConfigured();

    const body = req.body as HandleUploadBody | undefined;
    if (!body || typeof body !== "object" || typeof body.type !== "string") {
      return res.status(400).json({ error: "Invalid blob upload payload." });
    }

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        validateUploadPathname(pathname);

        return {
          addRandomSuffix: true,
          allowedContentTypes: ["image/*"],
          maximumSizeInBytes: MAX_BLOB_UPLOAD_SIZE_BYTES,
          validUntil: Date.now() + CLIENT_TOKEN_TTL_MS
        };
      },
      onUploadCompleted: async () => {}
    });

    return res.status(200).json(jsonResponse);
  } catch (err) {
    return respondError(err, res);
  }
}

export async function blobCleanupController(req: Request, res: Response): Promise<Response> {
  try {
    const urls = parseCleanupUrls(asBody(req.body));
    const deleted = await deleteRemoteObjects(urls);
    return res.status(200).json({ ok: true, deleted });
  } catch (err) {
    return respondError(err, res);
  }
}

export async function blobDownloadController(req: Request, res: Response): Promise<Response | void> {
  try {
    const blobUrl = String(req.query.url || "").trim();
    if (!blobUrl) {
      return res.status(400).json({ error: "Missing blob url." });
    }

    const filenameValue = Array.isArray(req.query.filename) ? req.query.filename[0] : req.query.filename;
    const filename = typeof filenameValue === "string" ? filenameValue : "";
    const object = await getRemoteObject(blobUrl);

    res.status(200);
    res.setHeader("Content-Type", object.contentType || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-cache");
    if (object.etag) res.setHeader("ETag", object.etag);
    if (filename) {
      res.setHeader("Content-Disposition", attachmentContentDisposition(filename));
    }

    Readable.from(object.body).pipe(res);
  } catch (err) {
    return respondError(err, res);
  }
}
