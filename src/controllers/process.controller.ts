import { Request, Response } from "express";
import archiver from "archiver";
import { HttpError } from "../errors/http-error";
import { processOneImage } from "../services/image-processor.service";
import { parseBatchOptions, parseSingleOptions } from "../services/process-request.service";
import { extractClientOrderMarker, sanitizeBaseName } from "../utils/file-name";
import { outContentType } from "../utils/http";

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

export async function processBatchController(req: Request, res: Response): Promise<Response | void> {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No images uploaded. Field name must be 'images'." });
    }

    const options = parseBatchOptions(asBody(req.body));

    res.status(200);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=\"bulk-square-results.zip\"");

    const archive = archiver("zip", { zlib: { level: 9 } });
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
    archive.pipe(res);

    const zipGeneratedAt = new Date();
    const folderPrefix = options.downloadMode === "folder" ? "bulk-square-results/" : "";

    const orderedFiles = files
      .map((file, index) => {
        const { order, cleanName } = extractClientOrderMarker(file.originalname);
        return { file, index, order: order ?? index + 1, cleanName };
      })
      .sort((a, b) => (a.order - b.order) || (a.index - b.index));

    const padLen = String(orderedFiles.length).length;

    for (let i = 0; i < orderedFiles.length; i++) {
      const { file, cleanName } = orderedFiles[i];
      const { outputBuffer, squareSize, outExt } = await processOneImage({
        input: file.buffer,
        ...options
      });

      const baseName = sanitizeBaseName(cleanName);
      const orderPrefix = String(i + 1).padStart(padLen, "0");
      const marginSuffix = options.marginY > 0 ? `_my${options.marginY}` : "";
      const outName = `${folderPrefix}${orderPrefix}_${baseName}_square_${squareSize}${marginSuffix}.${outExt}`;
      archive.append(outputBuffer, { name: outName, date: zipGeneratedAt });
    }

    await archive.finalize();
  } catch (err) {
    return respondError(err, res);
  }
}

export async function processSingleController(req: Request, res: Response): Promise<Response | void> {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: "No image uploaded. Field name must be 'image'." });
    }

    const options = parseSingleOptions(asBody(req.body));
    const padLen = String(options.orderTotal).length;

    const { outputBuffer, squareSize, outExt } = await processOneImage({
      input: file.buffer,
      ...options
    });

    const { cleanName } = extractClientOrderMarker(file.originalname);
    const baseName = sanitizeBaseName(cleanName);
    const orderPrefix = String(options.order).padStart(padLen, "0");
    const marginSuffix = options.marginY > 0 ? `_my${options.marginY}` : "";
    const outName = `${orderPrefix}_${baseName}_square_${squareSize}${marginSuffix}.${outExt}`;

    res.status(200);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.setHeader("Content-Type", outContentType(options.format));
    res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
    res.send(outputBuffer);
  } catch (err) {
    return respondError(err, res);
  }
}
