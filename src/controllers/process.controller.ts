import { Request, Response } from "express";
import archiver from "archiver";
import { MAX_FILES_PER_BATCH } from "../config/process";
import { HttpError } from "../errors/http-error";
import { processOneImage } from "../services/image-processor.service";
import {
  createRemoteDownloadUploadStream,
  downloadRemoteObjectToBuffer,
  uploadRemoteDownloadBuffer
} from "../services/media-storage.service";
import { parseBatchOptions, parseBatchSources, parseSingleOptions, parseSingleSource } from "../services/process-request.service";
import { extractClientOrderMarker, replaceFinalExtension, sanitizeBaseName } from "../utils/file-name";
import { attachmentContentDisposition, outContentType } from "../utils/http";
import { BlobProcessSource } from "../types/process";

function asBody(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object") return input as Record<string, unknown>;
  return {};
}

function respondError(err: unknown, res: Response): Response {
  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: "Processing failed." });
}

interface BatchInputDescriptor {
  index: number;
  order: number;
  cleanName: string;
  getBuffer: () => Promise<Buffer>;
}

interface SingleInputDescriptor {
  cleanName: string;
  getBuffer: () => Promise<Buffer>;
}

function getResponseMode(body: Record<string, unknown>): "inline" | "blob" {
  const value = String(body.responseMode ?? "inline").trim().toLowerCase();
  return value === "blob" ? "blob" : "inline";
}

function createProcessedFilename(
  cleanName: string,
  order: number,
  orderTotal: number,
  squareSize: number,
  marginY: number,
  outExt: string
): string {
  const padLen = String(orderTotal).length;
  const baseName = sanitizeBaseName(cleanName);
  const orderPrefix = String(order).padStart(padLen, "0");
  const marginSuffix = marginY > 0 ? `_my${marginY}` : "";
  return `${orderPrefix}_${baseName}_square_${squareSize}${marginSuffix}.${outExt}`;
}

function toBatchInputDescriptor(source: BlobProcessSource, index: number): BatchInputDescriptor {
  return {
    index,
    order: index + 1,
    cleanName: source.originalName,
    getBuffer: async () => downloadRemoteObjectToBuffer(source.blobUrl)
  };
}

function resolveBatchInputs(req: Request): BatchInputDescriptor[] {
  const files = req.files as Express.Multer.File[] | undefined;
  if (files && files.length > 0) {
    return files
      .map((file, index) => {
        const { order, cleanName } = extractClientOrderMarker(file.originalname);
        return {
          index,
          order: order ?? index + 1,
          cleanName,
          getBuffer: async () => file.buffer
        };
      })
      .sort((a, b) => (a.order - b.order) || (a.index - b.index));
  }

  return parseBatchSources(asBody(req.body))
    .map(toBatchInputDescriptor)
    .sort((a, b) => (a.order - b.order) || (a.index - b.index));
}

function resolveSingleInput(req: Request): SingleInputDescriptor {
  const file = req.file as Express.Multer.File | undefined;
  if (file) {
    const { cleanName } = extractClientOrderMarker(file.originalname);
    return {
      cleanName,
      getBuffer: async () => file.buffer
    };
  }

  const source = parseSingleSource(asBody(req.body));
  return {
    cleanName: source.originalName,
    getBuffer: async () => downloadRemoteObjectToBuffer(source.blobUrl)
  };
}

export async function processBatchController(req: Request, res: Response): Promise<Response | void> {
  try {
    const body = asBody(req.body);
    const orderedFiles = resolveBatchInputs(req);
    if (orderedFiles.length === 0) {
      return res.status(400).json({ error: "No images provided." });
    }
    if (orderedFiles.length > MAX_FILES_PER_BATCH) {
      return res.status(400).json({ error: `Too many images. Maximum is ${MAX_FILES_PER_BATCH}.` });
    }

    const options = parseBatchOptions(body);
    const responseMode = getResponseMode(body);
    const filename = "bulk-square-results.zip";
    const shouldReturnBlobReference = responseMode === "blob";

    let archiveUpload:
      | {
        stream: NodeJS.WritableStream;
        upload: Promise<{ url: string; filename: string }>;
      }
      | null = null;

    if (!shouldReturnBlobReference) {
      res.status(200);
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    }

    const archive = archiver("zip", { zlib: { level: 1 } });
    archive.on("warning", (err) => {
      // eslint-disable-next-line no-console
      console.warn("archive warning:", err);
    });
    archive.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("archive error:", err);
      try {
        res.status(500).end();
      } catch {
        // ignore
      }
    });

    if (shouldReturnBlobReference) {
      archiveUpload = createRemoteDownloadUploadStream(filename, "application/zip");
      archive.pipe(archiveUpload.stream);
    } else {
      archive.pipe(res);
    }

    const zipGeneratedAt = new Date();
    const folderPrefix = options.downloadMode === "folder" ? "bulk-square-results/" : "";

    for (let i = 0; i < orderedFiles.length; i++) {
      const { cleanName, getBuffer } = orderedFiles[i];
      const input = await getBuffer();
      const { outputBuffer, squareSize, outExt } = await processOneImage({
        input,
        ...options
      });

      const filename = options.filenameMode === "original"
        ? replaceFinalExtension(cleanName, outExt)
        : createProcessedFilename(cleanName, i + 1, orderedFiles.length, squareSize, options.marginY, outExt);
      const outName = `${folderPrefix}${filename}`;
      archive.append(outputBuffer, { name: outName, date: zipGeneratedAt });
    }

    await archive.finalize();

    if (archiveUpload) {
      const uploaded = await archiveUpload.upload;
      return res.status(200).json(uploaded);
    }
  } catch (err) {
    return respondError(err, res);
  }
}

export async function processSingleController(req: Request, res: Response): Promise<Response | void> {
  try {
    const body = asBody(req.body);
    const file = req.file as Express.Multer.File | undefined;
    if (!file && !String(body.blobUrl ?? "").trim()) {
      return res.status(400).json({ error: "No image provided." });
    }

    const options = parseSingleOptions(body);
    const { cleanName, getBuffer } = resolveSingleInput(req);
    const input = await getBuffer();

    const { outputBuffer, squareSize, outExt } = await processOneImage({
      input,
      ...options
    });

    const outName = options.filenameMode === "original"
      ? replaceFinalExtension(cleanName, outExt)
      : createProcessedFilename(cleanName, options.order, options.orderTotal, squareSize, options.marginY, outExt);
    const responseMode = getResponseMode(body);

    if (responseMode === "blob") {
      const uploaded = await uploadRemoteDownloadBuffer(
        outName,
        outputBuffer,
        outContentType(options.format)
      );

      return res.status(200).json(uploaded);
    }

    res.status(200);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.setHeader("Content-Type", outContentType(options.format));
    res.setHeader("Content-Disposition", attachmentContentDisposition(outName));
    res.send(outputBuffer);
  } catch (err) {
    return respondError(err, res);
  }
}
