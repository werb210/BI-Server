import { Router } from "express";
import { getCarrierHealth } from "../services/carrierHealthService";
const router = Router();
router.get("/bi/carrier-health", async (_req, res) => { try { const h = await getCarrierHealth(); return res.json(h);} catch (err) { return res.status(500).json({ error: "health_check_failed", message: err instanceof Error ? err.message : String(err) }); }});
export default router;
