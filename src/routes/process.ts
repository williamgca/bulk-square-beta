import { Router } from "express";
import multer from "multer";
import { MAX_FILES_PER_BATCH } from "../config/process";
import { processBatchController, processSingleController } from "../controllers/process.controller";

export const processRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: MAX_FILES_PER_BATCH
  }
});

processRouter.post("/process", upload.array("images"), processBatchController);
processRouter.post("/process-single", upload.single("image"), processSingleController);
