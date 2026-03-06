import { DEFAULT_COLOR, MAX_SIZE, REMOVE_BG_FEATURE_ENABLED } from "../config/process";
import { HttpError } from "../errors/http-error";
import { parseBool } from "../utils/booleans";
import { hexToRgb, isHexColor } from "../utils/color";
import { DownloadMode, OutputFormat, ParsedBatchOptions, ParsedProcessOptions, SizeMode } from "../types/process";

interface SingleRequestExtra {
  order: number;
  orderTotal: number;
}

export interface ParsedSingleOptions extends ParsedProcessOptions, SingleRequestExtra {}

function parseDownloadMode(value: unknown): DownloadMode {
  const normalized = String(value ?? "zip").trim().toLowerCase();
  return normalized === "folder" ? "folder" : "zip";
}

function parseFormat(value: unknown): OutputFormat {
  const formatRaw = String(value ?? "png").trim().toLowerCase();
  if (formatRaw === "png" || formatRaw === "jpg" || formatRaw === "webp") return formatRaw;
  throw new HttpError("Invalid format. Use png, jpg, or webp.", 400);
}

function parseSizeMode(value: unknown): SizeMode {
  const sizeModeRaw = String(value ?? "auto").trim().toLowerCase();
  if (sizeModeRaw === "auto" || sizeModeRaw === "fixed") return sizeModeRaw;
  throw new HttpError("Invalid sizeMode. Use auto or fixed.", 400);
}

function parseFixedSize(value: unknown, sizeMode: SizeMode): number | null {
  if (sizeMode !== "fixed") return null;

  const size = Number(String(value ?? "").trim());
  if (!Number.isFinite(size) || size <= 0 || size > MAX_SIZE) {
    throw new HttpError(`Invalid size. Provide a number between 1 and ${MAX_SIZE}.`, 400);
  }

  return Math.round(size);
}

function parseMargin(value: unknown): number {
  const margin = Math.max(0, Math.round(Number(String(value ?? "0").trim()) || 0));
  if (!Number.isFinite(margin) || margin < 0 || margin > MAX_SIZE) {
    throw new HttpError(`Invalid margin. Provide a number between 0 and ${MAX_SIZE}.`, 400);
  }
  return margin;
}

function parseSharedOptions(body: Record<string, unknown>): ParsedProcessOptions {
  const colorRaw = String(body.color || "").trim();
  const removeBg = REMOVE_BG_FEATURE_ENABLED && parseBool(body.removeBg);

  if (!removeBg && !isHexColor(colorRaw)) {
    throw new HttpError("Invalid color. Use HEX like #ffffff or #fff.", 400);
  }

  const format = parseFormat(body.format);
  const sizeMode = parseSizeMode(body.sizeMode);
  const fixedSize = parseFixedSize(body.size, sizeMode);
  const marginY = parseMargin(body.margin);
  const background = isHexColor(colorRaw) ? hexToRgb(colorRaw) : hexToRgb(DEFAULT_COLOR);

  return { background, format, sizeMode, fixedSize, marginY, removeBg };
}

export function parseBatchOptions(body: Record<string, unknown>): ParsedBatchOptions {
  return {
    ...parseSharedOptions(body),
    downloadMode: parseDownloadMode(body.downloadMode)
  };
}

export function parseSingleOptions(body: Record<string, unknown>): ParsedSingleOptions {
  const order = Math.max(1, Number(String(body.order || "").trim()) || 1);
  const orderTotal = Math.max(order, Number(String(body.orderTotal || "").trim()) || order);

  return {
    ...parseSharedOptions(body),
    order,
    orderTotal
  };
}
