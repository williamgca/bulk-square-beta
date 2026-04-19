import { Router } from "express";
import { blobCleanupController, blobDownloadController, blobUploadController } from "../controllers/blob.controller";

export const blobRouter = Router();

blobRouter.get("/download", blobDownloadController);
blobRouter.post("/upload", blobUploadController);
blobRouter.post("/cleanup", blobCleanupController);
