import sharp from "sharp";
import { ProcessImageOptions, ProcessImageResult, RgbaColor } from "../types/process";

const MAX_AUTO_SQUARE_SIDE = 2400;

function encodeByFormat(
  pipeline: sharp.Sharp,
  format: ProcessImageOptions["format"],
  squareSize: number
): Promise<Buffer> {
  const isVeryLargeOutput = squareSize >= 2800;

  if (format === "png") {
    pipeline = pipeline.png({
      compressionLevel: 6,
      adaptiveFiltering: true,
      effort: 5
    });
  } else if (format === "jpg") {
    pipeline = pipeline.jpeg({
      quality: isVeryLargeOutput ? 82 : 85,
      mozjpeg: false,
      progressive: true
    });
  } else if (format === "webp") {
    pipeline = pipeline.webp({
      quality: isVeryLargeOutput ? 82 : 85,
      effort: 3
    });
  }

  return pipeline.toBuffer();
}

function getEffectiveBackground(background: RgbaColor, removeBg: boolean, format: ProcessImageOptions["format"]): RgbaColor {
  if (removeBg && format !== "jpg") return { r: 0, g: 0, b: 0, alpha: 0 };
  return background;
}

export async function processOneImage(params: ProcessImageOptions): Promise<ProcessImageResult> {
  const { input, background, format, sizeMode, fixedSize, marginY, removeBg } = params;

  const meta = await sharp(input, { failOnError: false }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  let squareSize = sizeMode === "fixed" && fixedSize ? fixedSize : Math.max(width, height);
  if (!squareSize || squareSize <= 0) {
    squareSize = 1024;
  }
  if (sizeMode === "auto") {
    squareSize = Math.min(squareSize, MAX_AUTO_SQUARE_SIDE);
  }

  const outExt = format === "jpg" ? "jpg" : format;
  const hasAlpha = meta.hasAlpha === true;
  const inputIsPng = meta.format === "png";
  const effectiveBackground = getEffectiveBackground(background, removeBg, format);

  const safeMargin = Number.isFinite(marginY) ? Math.max(0, Math.round(marginY)) : 0;

  let pipeline = sharp(input, { failOnError: false, sequentialRead: true })
    .ensureAlpha()
    .resize({
      width: squareSize,
      height: squareSize,
      fit: "contain",
      position: "center",
      background: effectiveBackground
    });

  if (hasAlpha && !removeBg && (inputIsPng || format === "jpg" || format === "webp")) {
    pipeline = pipeline.flatten({ background: effectiveBackground });
  }

  if (hasAlpha && removeBg && format === "jpg") {
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255, alpha: 1 } });
  }

  if (safeMargin > 0) {
    pipeline = pipeline.extend({
      top: safeMargin,
      bottom: safeMargin,
      left: safeMargin,
      right: safeMargin,
      background: effectiveBackground
    });
  }

  const outputBuffer = await encodeByFormat(pipeline, format, squareSize);

  return { outputBuffer, squareSize, outExt };
}
