import sharp from "sharp";
import { ProcessImageOptions, ProcessImageResult, RgbaColor } from "../types/process";

function encodeByFormat(input: Buffer, format: ProcessImageOptions["format"]): Promise<Buffer> {
  let pipeline = sharp(input, { failOnError: false });

  if (format === "png") {
    pipeline = pipeline.png({ compressionLevel: 9 });
  } else if (format === "jpg") {
    pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
  } else if (format === "webp") {
    pipeline = pipeline.webp({ quality: 90 });
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

  const outExt = format === "jpg" ? "jpg" : format;
  const hasAlpha = meta.hasAlpha === true;
  const inputIsPng = meta.format === "png";
  const effectiveBackground = getEffectiveBackground(background, removeBg, format);

  let pipeline = sharp(input, { failOnError: false })
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

  const squareRaw = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  let outputBuffer = await encodeByFormat(squareRaw, format);

  const safeMargin = Number.isFinite(marginY) ? Math.max(0, Math.round(marginY)) : 0;
  if (safeMargin > 0) {
    const squareMeta = await sharp(squareRaw, { failOnError: false }).metadata();
    const baseW = Math.max(1, Math.round(squareMeta.width || squareSize));
    const baseH = Math.max(1, Math.round(squareMeta.height || squareSize));
    const baseSide = Math.max(baseW, baseH);

    const squareBase = await sharp({
      create: {
        width: baseSide,
        height: baseSide,
        channels: 4,
        background: effectiveBackground
      }
    })
      .composite([
        {
          input: squareRaw,
          left: Math.floor((baseSide - baseW) / 2),
          top: Math.floor((baseSide - baseH) / 2)
        }
      ])
      .png({ compressionLevel: 9 })
      .toBuffer();

    const finalSide = baseSide + safeMargin * 2;
    const withMargin = await sharp({
      create: {
        width: finalSide,
        height: finalSide,
        channels: 4,
        background: effectiveBackground
      }
    })
      .composite([
        {
          input: squareBase,
          left: safeMargin,
          top: safeMargin
        }
      ])
      .png({ compressionLevel: 9 })
      .toBuffer();

    outputBuffer = await encodeByFormat(withMargin, format);
  }

  return { outputBuffer, squareSize, outExt };
}
