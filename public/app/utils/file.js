export function sanitizeBaseName(filename) {
  const name = String(filename || "image");
  const base = name.replace(/\.[^/.]+$/, "");
  return (base || "image").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

export function computeFallbackFilename(file, format, order, orderTotal, marginY) {
  const padLen = String(orderTotal || order || 1).length;
  const prefix = String(order || 1).padStart(padLen, "0");
  const base = sanitizeBaseName(file && file.name ? file.name : "image");
  const ext = format === "jpg" ? "jpg" : format;
  const marginSuffix = Number(marginY) > 0 ? `_my${Number(marginY)}` : "";
  return `${prefix}_${base}_square${marginSuffix}.${ext}`;
}

export function parseFilenameFromContentDisposition(header) {
  if (!header) return null;

  const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(header);
  const raw = (match && (match[1] || match[2] || match[3])) ? String(match[1] || match[2] || match[3]).trim() : "";
  if (!raw) return null;

  try {
    return decodeURIComponent(raw.replace(/^"|"$/g, ""));
  } catch {
    return raw.replace(/^"|"$/g, "");
  }
}
