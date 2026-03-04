import { Router } from "express";
import multer from "multer";
import archiver from "archiver";
import path from "path";
import sharp from "sharp";

export const processRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB per file
    files: 200
  }
});

type OutputFormat = "png" | "jpg" | "webp";
type SizeMode = "auto" | "fixed";
type DownloadMode = "zip" | "folder";

function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function hexToRgb(hex: string): { r: number; g: number; b: number; alpha: number } {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { r, g, b, alpha: 1 };
}

function sanitizeBaseName(filename: string): string {
  // keep it simple for zip entries
  const base = path.parse(filename).name;
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "image";
}

function extractClientOrderMarker(originalname: string): { order: number | null; cleanName: string } {
  // Client may send: __o001__myfile.png to preserve original upload order.
  const m = /^__o(\d+)__/.exec(originalname);
  if (!m) return { order: null, cleanName: originalname };
  const order = Number(m[1]);
  const cleanName = originalname.replace(/^__o\d+__/, "");
  return { order: Number.isFinite(order) ? order : null, cleanName };
}

function parseDownloadMode(value: unknown): DownloadMode {
  const v = String(value ?? "zip").trim().toLowerCase();
  return v === "folder" ? "folder" : "zip";
}

function outContentType(format: OutputFormat): string {
  if (format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

async function processOneImage(params: {
  input: Buffer;
  background: { r: number; g: number; b: number; alpha: number };
  format: OutputFormat;
  sizeMode: SizeMode;
  fixedSize: number | null;
  marginY: number;
}): Promise<{ outputBuffer: Buffer; squareSize: number; outExt: string; outHeight: number }> {
  const { input, background, format, sizeMode, fixedSize, marginY } = params;

  const meta = await sharp(input, { failOnError: false }).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  let squareSize: number;
  if (sizeMode === "fixed" && fixedSize) {
    squareSize = fixedSize;
  } else {
    squareSize = Math.max(w, h);
    // Fallback if metadata missing
    if (!squareSize || squareSize <= 0) {
      squareSize = 1024;
    }
  }

  const outExt = format === "jpg" ? "jpg" : format;

  async function encodeByFormat(input: Buffer): Promise<Buffer> {
    let p = sharp(input, { failOnError: false });
    if (format === "png") {
      p = p.png({ compressionLevel: 9 });
    } else if (format === "jpg") {
      p = p.jpeg({ quality: 90, mozjpeg: true });
    } else if (format === "webp") {
      p = p.webp({ quality: 90 });
    }
    return await p.toBuffer();
  }

  // NOTE about transparent PNGs:
  // Some transparent images (usually PNGs) can look black/dark after padding or format conversion
  // because alpha gets flattened over black by default or because transparency remains.
  // We explicitly flatten over the chosen background color when alpha is present.
  const hasAlpha = meta.hasAlpha === true;
  const inputIsPng = meta.format === "png";

  let pipeline = sharp(input, { failOnError: false })
    .ensureAlpha()
    .resize({
      width: squareSize,
      height: squareSize,
      fit: "contain",
      position: "center",
      background
    });

  // If it has transparency (common for PNG) we replace the transparent background with the
  // selected fill color to prevent dark/black artifacts.
  if (hasAlpha && (inputIsPng || format === "jpg" || format === "webp")) {
    pipeline = pipeline.flatten({ background });
  }

  // Stage 1: base square image (already padded to square with selected background color).
  const squareRaw = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  let outputBuffer = await encodeByFormat(squareRaw);

  const safeMargin = Number.isFinite(marginY) ? Math.max(0, Math.round(marginY)) : 0;
  const squareMeta = await sharp(squareRaw, { failOnError: false }).metadata();
  const baseW = Math.max(1, Math.round(squareMeta.width || squareSize));
  const baseH = Math.max(1, Math.round(squareMeta.height || squareSize));
  const baseSide = Math.max(baseW, baseH);
  const outHeight = baseSide + safeMargin * 2;

  // Stage 2: apply margin on a guaranteed-square base, then keep final output square.
  if (safeMargin > 0) {
    const squareBase = await sharp({
      create: {
        width: baseSide,
        height: baseSide,
        channels: 4,
        background
      }
    }).composite([{
      input: squareRaw,
      left: Math.floor((baseSide - baseW) / 2),
      top: Math.floor((baseSide - baseH) / 2)
    }]).png({ compressionLevel: 9 }).toBuffer();

    const finalSide = baseSide + safeMargin * 2;
    const withMargin = await sharp({
      create: {
        width: finalSide,
        height: finalSide,
        channels: 4,
        background
      }
    }).composite([{
      input: squareBase,
      left: safeMargin,
      top: safeMargin
    }]).png({ compressionLevel: 9 }).toBuffer();

    outputBuffer = await encodeByFormat(withMargin);
  }

  return { outputBuffer, squareSize, outExt, outHeight };
}

processRouter.post("/process", upload.array("images"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No images uploaded. Field name must be 'images'." });
    }

    const colorRaw = String(req.body.color || "").trim();
    const formatRaw = String(req.body.format || "png").trim().toLowerCase();
    const sizeModeRaw = String(req.body.sizeMode || "auto").trim().toLowerCase();
    const sizeRaw = String(req.body.size || "").trim();
    const marginRaw = String(req.body.margin ?? "0").trim();
    const downloadMode = parseDownloadMode(req.body.downloadMode);

    if (!isHexColor(colorRaw)) {
      return res.status(400).json({ error: "Invalid color. Use HEX like #ffffff or #fff." });
    }

    const format = (["png", "jpg", "webp"].includes(formatRaw) ? formatRaw : null) as OutputFormat | null;
    if (!format) {
      return res.status(400).json({ error: "Invalid format. Use png, jpg, or webp." });
    }

    const sizeMode = (["auto", "fixed"].includes(sizeModeRaw) ? sizeModeRaw : null) as SizeMode | null;
    if (!sizeMode) {
      return res.status(400).json({ error: "Invalid sizeMode. Use auto or fixed." });
    }

    let fixedSize: number | null = null;
    if (sizeMode === "fixed") {
      const n = Number(sizeRaw);
      if (!Number.isFinite(n) || n <= 0 || n > 10000) {
        return res.status(400).json({ error: "Invalid size. Provide a number between 1 and 10000." });
      }
      fixedSize = Math.round(n);
    }

    const background = hexToRgb(colorRaw);

    const marginY = Math.max(0, Math.round(Number(marginRaw) || 0));
    if (!Number.isFinite(marginY) || marginY < 0 || marginY > 10000) {
      return res.status(400).json({ error: "Invalid margin. Provide a number between 0 and 10000." });
    }

    res.status(200);
    // Useful if the UI is hosted on another origin and needs to read the filename.
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

    // Use ZIP generation time so extracted files have a sensible modified date.
    const zipGeneratedAt = new Date();

    const folderPrefix = downloadMode === "folder" ? "bulk-square-results/" : "";

    // Enforce a stable order (some environments can reorder multipart parts).
    // If the client provided an order marker, we sort by it; otherwise fall back to arrival index.
    const ordered = files
      .map((file, idx) => {
        const { order, cleanName } = extractClientOrderMarker(file.originalname);
        return { file, idx, order: order ?? idx + 1, cleanName };
      })
      .sort((a, b) => (a.order - b.order) || (a.idx - b.idx));

    const padLen = String(ordered.length).length;

    for (let i = 0; i < ordered.length; i++) {
      const { file, cleanName } = ordered[i];
      const input = file.buffer;

      const { outputBuffer, squareSize, outExt } = await processOneImage({
        input,
        background,
        format,
        sizeMode,
        fixedSize,
        marginY
      });

      const baseName = sanitizeBaseName(cleanName);
      const orderPrefix = String(i + 1).padStart(padLen, "0");
      const marginSuffix = marginY > 0 ? `_my${marginY}` : "";
      const outName = `${folderPrefix}${orderPrefix}_${baseName}_square_${squareSize}${marginSuffix}.${outExt}`;

      archive.append(outputBuffer, { name: outName, date: zipGeneratedAt });
    }

    await archive.finalize();
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Processing failed." });
  }
});

// Process a single image and return it directly as a file download.
// Useful for: download-as-folder (File System Access API) and separate downloads.
processRouter.post("/process-single", upload.single("image"), async (req, res) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: "No image uploaded. Field name must be 'image'." });
    }

    const colorRaw = String(req.body.color || "").trim();
    const formatRaw = String(req.body.format || "png").trim().toLowerCase();
    const sizeModeRaw = String(req.body.sizeMode || "auto").trim().toLowerCase();
    const sizeRaw = String(req.body.size || "").trim();
    const marginRaw = String(req.body.margin ?? "0").trim();

    const orderRaw = String(req.body.order || "").trim();
    const orderTotalRaw = String(req.body.orderTotal || "").trim();
    const order = Math.max(1, Number(orderRaw) || 1);
    const orderTotal = Math.max(order, Number(orderTotalRaw) || order);
    const padLen = String(orderTotal).length;

    if (!isHexColor(colorRaw)) {
      return res.status(400).json({ error: "Invalid color. Use HEX like #ffffff or #fff." });
    }

    const format = (['png', 'jpg', 'webp'].includes(formatRaw) ? formatRaw : null) as OutputFormat | null;
    if (!format) {
      return res.status(400).json({ error: "Invalid format. Use png, jpg, or webp." });
    }

    const sizeMode = (['auto', 'fixed'].includes(sizeModeRaw) ? sizeModeRaw : null) as SizeMode | null;
    if (!sizeMode) {
      return res.status(400).json({ error: "Invalid sizeMode. Use auto or fixed." });
    }

    let fixedSize: number | null = null;
    if (sizeMode === 'fixed') {
      const n = Number(sizeRaw);
      if (!Number.isFinite(n) || n <= 0 || n > 10000) {
        return res.status(400).json({ error: "Invalid size. Provide a number between 1 and 10000." });
      }
      fixedSize = Math.round(n);
    }

    const background = hexToRgb(colorRaw);

    const marginY = Math.max(0, Math.round(Number(marginRaw) || 0));
    if (!Number.isFinite(marginY) || marginY < 0 || marginY > 10000) {
      return res.status(400).json({ error: "Invalid margin. Provide a number between 0 and 10000." });
    }

    const { outputBuffer, squareSize, outExt } = await processOneImage({
      input: file.buffer,
      background,
      format,
      sizeMode,
      fixedSize,
      marginY
    });

    const { cleanName } = extractClientOrderMarker(file.originalname);
    const baseName = sanitizeBaseName(cleanName);
    const orderPrefix = String(order).padStart(padLen, '0');
    const marginSuffix = marginY > 0 ? `_my${marginY}` : "";
    const outName = `${orderPrefix}_${baseName}_square_${squareSize}${marginSuffix}.${outExt}`;

    res.status(200);
    // Useful if the UI is hosted on another origin and needs to read the filename.
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.setHeader('Content-Type', outContentType(format));
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.send(outputBuffer);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Processing failed." });
  }
});
