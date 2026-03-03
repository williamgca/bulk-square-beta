import express from "express";
import path from "path";
import { processRouter } from "./routes/process";

const app = express();

const PORT = Number(process.env.PORT || 3000);

// Static UI
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

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
