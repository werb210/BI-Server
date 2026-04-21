import { Router } from "express";
import { submitApplication } from "../controllers/pgiController";

const router = Router();

router.post("/submit", submitApplication);

export default router;
