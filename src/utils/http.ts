import { OutputFormat } from "../types/process";

export function outContentType(format: OutputFormat): string {
  if (format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}
