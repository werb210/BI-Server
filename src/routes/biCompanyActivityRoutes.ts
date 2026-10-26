// BI_SERVER_v789_COMPANY_ACTIVITY [89] - activity timeline on a CRM company.
// Mounted at /api/v1/bi behind requireAuth; staff only (service tokens 403).
//   GET  /crm/companies/:id/activity -> { ok, events: [...], items: [...] } newest first
//   POST /crm/companies/:id/activity { event_type, outcome?, body?, meta? }
//        -> 201 { ok, activity_id, event }
// Same event types and body/meta handling as
// POST /crm/outreach/contacts/:id/activity (shared parseCrmActivityInput).
// Guards are per route, not router.use: this router sits on the shared
// "/api/v1/bi" prefix and must not gate other routers' requests.
import { Router, type Request, type Response } from "express";
import { pool } from "../db";
import { logHiddenError } from "../platform/safeError";
import { requireStaffUser } from "../middleware/requireStaffUser";
import { crmActorFrom, parseCrmActivityInput, redactActivityRows } from "../lib/crmActivityInput";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVITY_COLUMNS = "id, company_id, actor_id, actor_name, event_type, outcome, body, meta, created_at, occurred_at";

router.get("/crm/companies/:id/activity", requireStaffUser, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  try {
    const co = await pool.query(`SELECT 1 FROM bi_companies WHERE id = $1 LIMIT 1`, [id]);
    if (!co.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
    // BI_SERVER_v856_CRM_UNIFY - the company's own activity plus its people's (calls, emails, notes on their contact
    // records), labelled with whose it is, so a company whose contacts are busy no longer says "No activity yet".
    const r = await pool.query(
      `SELECT * FROM (
         SELECT ${ACTIVITY_COLUMNS}, NULL::text AS contact_id, NULL::text AS contact_name
           FROM bi_company_activity
          WHERE company_id = $1
         UNION ALL
         SELECT a.id, $1::uuid AS company_id, a.actor_id, a.actor_name, a.event_type, a.outcome, a.body, a.meta, a.created_at, a.occurred_at,
                c.id::text AS contact_id, c.full_name AS contact_name
           FROM bi_contact_activity a
           JOIN bi_contacts c ON c.id = a.contact_id
          WHERE c.converted_to_company_id IS NULL
            AND (c.company_id = $1
                 OR c.id IN (SELECT contact_id FROM bi_crm_company_people WHERE company_id = $1)
                 OR c.id IN (SELECT primary_contact_id FROM bi_applications WHERE company_id = $1 AND primary_contact_id IS NOT NULL))
       ) x
        ORDER BY occurred_at DESC, created_at DESC
        LIMIT ${limit}`,
      [id],
    );
    const events = redactActivityRows(r.rows);
    return res.json({ ok: true, events, items: events });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "activity_failed", requestId: logHiddenError(req, err, "company_activity_list_failed") });
  }
});

router.post("/crm/companies/:id/activity", requireStaffUser, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  const parsed = parseCrmActivityInput(req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
  const { eventType, outcome, body, meta } = parsed.value;
  const actor = crmActorFrom(req);
  try {
    // INSERT ... SELECT: no row when the company does not exist -> 404.
    const r = await pool.query(
      `INSERT INTO bi_company_activity (company_id, actor_id, actor_name, event_type, outcome, body, meta)
       SELECT co.id, $2, $3, $4, $5, $6, $7::jsonb
         FROM bi_companies co
        WHERE co.id = $1
       RETURNING ${ACTIVITY_COLUMNS}`,
      [id, actor.id, actor.name, eventType, outcome, body, meta ? JSON.stringify(meta) : null],
    );
    const row = r.rows[0] as { id: string } | undefined;
    if (!row) return res.status(404).json({ ok: false, error: "not_found" });
    return res.status(201).json({ ok: true, activity_id: row.id, event: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "activity_failed", requestId: logHiddenError(req, err, "company_activity_create_failed") });
  }
});

export default router;
