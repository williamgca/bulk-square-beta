export type OutputFormat = "png" | "jpg" | "webp";
export type SizeMode = "auto" | "fixed";
export type DownloadMode = "zip" | "folder";

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

export interface ProcessImageOptions {
  input: Buffer;
  background: RgbaColor;
  format: OutputFormat;
  sizeMode: SizeMode;
  fixedSize: number | null;
  marginY: number;
  removeBg: boolean;
}

export interface ProcessImageResult {
  outputBuffer: Buffer;
  squareSize: number;
  outExt: string;
}

export interface ParsedProcessOptions {
  background: RgbaColor;
  format: OutputFormat;
  sizeMode: SizeMode;
  fixedSize: number | null;
  marginY: number;
  removeBg: boolean;
}

export interface ParsedBatchOptions extends ParsedProcessOptions {
  downloadMode: DownloadMode;
}
