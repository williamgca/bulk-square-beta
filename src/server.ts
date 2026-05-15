import express from "express";
import path from "path";
import { MAX_FILES_PER_BATCH } from "./config/process";
import { blobRouter } from "./routes/blob";
import { processRouter } from "./routes/process";
import { getRemoteStorageAvailability } from "./services/media-storage.service";

const app = express();

const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));

app.get("/api/runtime-config", async (_req, res) => {
  const remoteStorage = await getRemoteStorageAvailability();

  res.json({
    blobStorageEnabled: remoteStorage.enabled,
    blobStorageReason: remoteStorage.reason || null,
    storageProvider: remoteStorage.provider,
    maxFilesPerBatch: MAX_FILES_PER_BATCH
  });
});

// Static UI
const publicDir = path.join(__dirname, "..", "public");
app.use("/vendor/vercel-blob", express.static(path.join(__dirname, "..", "node_modules", "@vercel", "blob", "dist")));
app.use(express.static(publicDir));
// Remove BG feature isolated/disabled for now:
// app.use("/vendor/background-removal", express.static(path.join(__dirname, "..", "node_modules", "@imgly", "background-removal", "dist")));
// app.use("/vendor/onnxruntime-web", express.static(path.join(__dirname, "..", "node_modules", "onnxruntime-web", "dist")));
// app.use("/onnxruntime-web", express.static(path.join(__dirname, "..", "node_modules", "onnxruntime-web", "dist")));

// API
app.use("/api/blob", blobRouter);
app.use("/api", processRouter);

// Basic health
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
});
