import path from "path";

export function sanitizeBaseName(filename: string): string {
  const base = path.parse(filename).name;
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "image";
}

function getFilenameSegment(filename: string): string {
  const value = String(filename || "").replace(/[\u0000-\u001f\u007f]/g, "");
  const lastSlash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  const segment = lastSlash >= 0 ? value.slice(lastSlash + 1) : value;
  return segment || "image";
}

export function replaceFinalExtension(filename: string, extension: string): string {
  const safeExt = String(extension || "").replace(/^\.+/, "") || "png";
  const originalName = getFilenameSegment(filename);
  const baseName = originalName.replace(/\.[^./\\]+$/, "") || "image";
  return `${baseName}.${safeExt}`;
}

export function extractClientOrderMarker(originalname: string): { order: number | null; cleanName: string } {
  const marker = /^__o(\d+)__/.exec(originalname);
  if (!marker) return { order: null, cleanName: originalname };

  const order = Number(marker[1]);
  const cleanName = originalname.replace(/^__o\d+__/, "");
  return { order: Number.isFinite(order) ? order : null, cleanName };
}
