// BI_SERVER_LEAD_SCORES_v1 - POST /api/v1/bi/lead-scores/lookup { contact_ids } -> { enabled, scores } (same contract as
// BF-Server /api/lead-scores/lookup), so the portal shows the same Hot / Warm / Cold badges on Insurance contacts.
import { Router } from "express";
import { pool } from "../db";
import { logger } from "../platform/logger";
import { requireStaffUser } from "../middleware/requireStaffUser";
import { lookupLeadScores } from "../services/leadScores";

const router = Router();
router.post("/lead-scores/lookup", requireStaffUser, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.contact_ids) ? req.body.contact_ids.map(String) : [];
    res.json({ ok: true, enabled: true, scores: await lookupLeadScores(pool as any, ids) });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "bi_lead_scores_failed");
    res.status(500).json({ ok: false, error: "lead_scores_failed" });
  }
});
export default router;
