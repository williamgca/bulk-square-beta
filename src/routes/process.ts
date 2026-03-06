import { Router } from "express";
import multer from "multer";
import { processBatchController, processSingleController } from "../controllers/process.controller";

export const processRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 200
  }
});

processRouter.post("/process", upload.array("images"), processBatchController);
processRouter.post("/process-single", upload.single("image"), processSingleController);
