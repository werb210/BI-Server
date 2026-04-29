import { Router, type Request, type Response } from "express";
import { pool } from "../db";
import { ok, badRequest } from "../utils/apiResponse";
import { enrichContact } from "../integrations/apollo/apolloEnrichOnDemand";
import { logger } from "../platform/logger";

const router = Router();
router.post("/contacts/:id/enrich", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return badRequest(res, "invalid contact id");
  try { return ok(res, await enrichContact(id, { force: req.query.force === "1" })); }
  catch (err) { logger.error({ err, id }, "enrich failed"); return badRequest(res, "enrichment failed"); }
});
router.get("/contacts/:id/marketing", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return badRequest(res, "invalid contact id");
  const contact = await pool.query(`SELECT id, full_name, email, apollo_contact_id, apollo_data, apollo_stage, apollo_sequence_names, apollo_last_synced_at FROM bi_contacts WHERE id = $1 LIMIT 1`, [id]);
  if (!contact.rows[0]) return badRequest(res, "contact not found");
  const events = await pool.query(`SELECT id, event_type, sequence_name, occurred_at, metadata FROM bi_crm_engagement_events WHERE contact_id = $1 ORDER BY occurred_at DESC LIMIT 100`, [id]);
  return ok(res, { contact: contact.rows[0], events: events.rows });
});
router.get("/marketing/engagement-summary", async (_req: Request, res: Response) => {
  const summary = await pool.query<{ event_type: string; cnt: string }>(`SELECT event_type, COUNT(*) AS cnt FROM bi_crm_engagement_events WHERE occurred_at > NOW() - INTERVAL '30 days' GROUP BY event_type`);
  const counts: Record<string, number> = {};
  for (const row of summary.rows) counts[row.event_type] = Number(row.cnt);
  return ok(res, { window_days: 30, counts });
});
router.post("/admin/apollo/sync", async (_req: Request, res: Response) => {
  try { const mod = await import("../jobs/apolloSyncJob"); await mod.runApolloSyncOnce(); return ok(res, { triggered: true }); }
  catch (err) { logger.error({ err }, "apollo sync trigger failed"); return badRequest(res, "sync trigger failed"); }
});
export default router;
