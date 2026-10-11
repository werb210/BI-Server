import { logHiddenError } from "../platform/safeError";
import { Router } from "express";
import { getCarrierHealth } from "../services/carrierHealthService";
const router = Router();
router.get("/bi/carrier-health", async (req, res) => { try { const h = await getCarrierHealth(); return res.json(h);} catch (err) { return res.status(500).json({ error: "health_check_failed", requestId: logHiddenError(req, err, "health_check_failed") }); }});
export default router;
