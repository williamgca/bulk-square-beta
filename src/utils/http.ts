import { OutputFormat } from "../types/process";

export function outContentType(format: OutputFormat): string {
  if (format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => (
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

function asciiFilenameFallback(filename: string): string {
  return String(filename || "download.bin")
    .replace(/[\\/\r\n"]/g, "_")
    .replace(/[^\x20-\x7e]+/g, "_")
    .trim() || "download.bin";
}

export function attachmentContentDisposition(filename: string): string {
  const cleanFilename = String(filename || "download.bin").replace(/[\r\n\u0000]/g, "") || "download.bin";
  const fallback = asciiFilenameFallback(cleanFilename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(cleanFilename)}`;
}
