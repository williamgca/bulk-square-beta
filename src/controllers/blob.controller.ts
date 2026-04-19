import { Request, Response } from "express";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { HttpError } from "../errors/http-error";
import { assertBlobConfigured, deleteBlobUrls } from "../services/blob-storage.service";

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

export async function blobUploadController(req: Request, res: Response): Promise<Response> {
  try {
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
    const deleted = await deleteBlobUrls(urls);
    return res.status(200).json({ ok: true, deleted });
  } catch (err) {
    return respondError(err, res);
  }
}
