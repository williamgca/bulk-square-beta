import path from "path";

export function sanitizeBaseName(filename: string): string {
  const base = path.parse(filename).name;
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "image";
}

export function extractClientOrderMarker(originalname: string): { order: number | null; cleanName: string } {
  const marker = /^__o(\d+)__/.exec(originalname);
  if (!marker) return { order: null, cleanName: originalname };

  const order = Number(marker[1]);
  const cleanName = originalname.replace(/^__o\d+__/, "");
  return { order: Number.isFinite(order) ? order : null, cleanName };
}
