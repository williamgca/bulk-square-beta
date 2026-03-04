import express from "express";
import path from "path";
import { processRouter } from "./routes/process";

const app = express();

const PORT = Number(process.env.PORT || 3000);

// Static UI
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
// Remove BG feature isolated/disabled for now:
// app.use("/vendor/background-removal", express.static(path.join(__dirname, "..", "node_modules", "@imgly", "background-removal", "dist")));
// app.use("/vendor/onnxruntime-web", express.static(path.join(__dirname, "..", "node_modules", "onnxruntime-web", "dist")));
// app.use("/onnxruntime-web", express.static(path.join(__dirname, "..", "node_modules", "onnxruntime-web", "dist")));

// API
app.use("/api", processRouter);

// Basic health
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
});
