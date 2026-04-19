import { Router } from "express";
import { blobCleanupController, blobUploadController } from "../controllers/blob.controller";

export const blobRouter = Router();

blobRouter.post("/upload", blobUploadController);
blobRouter.post("/cleanup", blobCleanupController);
