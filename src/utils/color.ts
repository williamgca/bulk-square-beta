import { RgbaColor } from "../types/process";

export function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

export function hexToRgb(hex: string): RgbaColor {
  let normalized = hex.replace("#", "").trim();
  if (normalized.length === 3) {
    normalized = normalized.split("").map((char) => char + char).join("");
  }

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return { r, g, b, alpha: 1 };
}
