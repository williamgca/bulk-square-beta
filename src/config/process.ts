export const REMOVE_BG_FEATURE_ENABLED = false;
export const MAX_SIZE = 10000;
export const DEFAULT_COLOR = "#ffffff";
export const MAX_FILES_PER_BATCH = 600;
export const MEDIA_STORAGE_MODE = String(process.env.MEDIA_STORAGE_MODE || "auto").trim().toLowerCase();
const IS_VERCEL_RUNTIME = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

export const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
export const SUPABASE_PUBLISHABLE_KEY = String(
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ""
).trim();
export const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
export const SUPABASE_STORAGE_BUCKET = String(process.env.SUPABASE_STORAGE_BUCKET || "bulk-square").trim();
export const SUPABASE_STORAGE_REQUESTED = MEDIA_STORAGE_MODE === "supabase"
  || (
    MEDIA_STORAGE_MODE === "auto"
    && IS_VERCEL_RUNTIME
    && Boolean(SUPABASE_URL || SUPABASE_PUBLISHABLE_KEY || SUPABASE_SERVICE_ROLE_KEY)
  );

export const BLOB_STORAGE_REQUESTED = !SUPABASE_STORAGE_REQUESTED
  && Boolean(process.env.BLOB_READ_WRITE_TOKEN)
  && (MEDIA_STORAGE_MODE === "blob" || (MEDIA_STORAGE_MODE !== "local" && IS_VERCEL_RUNTIME));
export const BLOB_STORAGE_ENABLED = BLOB_STORAGE_REQUESTED;
