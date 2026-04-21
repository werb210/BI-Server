import { Router } from "express";
import { submitApplication } from "../controllers/pgiController";
import { handlePGIWebhook } from "../controllers/pgiWebhookController";

const router = Router();

router.post("/submit", submitApplication);
router.post("/webhook", handlePGIWebhook);

export default router;
