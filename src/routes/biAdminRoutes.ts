import { Router } from "express";
import { runContactSyncOnce } from "../jobs/apolloSyncJob";
import { logger } from "../platform/logger";
const router = Router();
router.post("/crm/apollo/import-list", async (req: any, res) => {
  const labelId = String(req.body?.label_id ?? "").trim();
  if (!labelId) return res.status(400).json({ error: "missing_label_id" });
  try {
    const result = await runContactSyncOnce({ includeNotInSequence: true, sinceOverride: null });
    logger.info({ labelId, ...result }, "[v320] manual apollo list import complete");
    return res.json({ ok: true, label_id: labelId, ...result });
  } catch (err) {
    return res.status(502).json({ error: "import_failed", detail: String((err as Error)?.message ?? err) });
  }
});
router.post("/crm/apollo/import-all", async (_req: any, res) => {
  try {
    const result = await runContactSyncOnce({ includeNotInSequence: true, sinceOverride: null });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(502).json({ error: "import_failed", detail: String((err as Error)?.message ?? err) });
  }
});
export default router;
