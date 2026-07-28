import { Router } from "express";
import { pool } from "../db";
import { audienceParams, buildAudienceBreakdownSql, buildAudienceCountSql, type AudienceFilter } from "../services/biEmailAudience";
import { sendgridConfigured } from "../services/biSendgridService";

const router: Router = Router();
const filterFrom = (value: unknown): AudienceFilter => {
  const body = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    includeTags: Array.isArray(body.includeTags) ? body.includeTags.filter((v): v is string => typeof v === "string") : undefined,
    excludeTags: Array.isArray(body.excludeTags) ? body.excludeTags.filter((v): v is string => typeof v === "string") : undefined,
  };
};

router.post("/email/audience-count", async (req, res) => {
  try {
    const filter = filterFrom(req.body);
    const [count, breakdown] = await Promise.all([
      pool.query(buildAudienceCountSql(), audienceParams(filter)), pool.query(buildAudienceBreakdownSql()),
    ]);
    const row = breakdown.rows[0] || {};
    return res.json({ eligible: count.rows[0]?.count || 0, breakdown: {
      withEmail: row.with_email || 0, suppressed: row.suppressed || 0,
      noConsentRecorded: row.no_consent_recorded || 0, consentExpired: row.consent_expired || 0,
    }, sendgridConfigured: sendgridConfigured() });
  } catch (err) { return res.status(500).json({ error: { code: "internal", message: err instanceof Error ? err.message : String(err) } }); }
});

router.post("/email/send-template", async (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  if (!sendgridConfigured()) return res.status(503).json({ error: { code: "sendgrid_not_configured" } });
  if (typeof body.templateId !== "string") return res.status(400).json({ error: { code: "template_id_required" } });
  const template = await pool.query("SELECT id,subject,body_html,body_text FROM bi_email_templates WHERE id=$1 AND is_active=TRUE", [body.templateId]);
  if (!template.rowCount) return res.status(404).json({ error: { code: "template_not_found" } });
  const hold = Math.max(0, Number(process.env.BI_SEND_HOLD_MINUTES || 2));
  const t = template.rows[0];
  const job = await pool.query(`INSERT INTO bi_marketing_send_jobs(template_id,subject,html,text_body,filters,scheduled_at,created_by)
    VALUES($1,$2,$3,$4,$5::jsonb,NOW()+($6 * interval '1 minute'),$7) RETURNING *`,
    [t.id, t.subject || "", t.body_html || "", t.body_text, JSON.stringify(filterFrom(body.filters)), hold, (req as any).user?.id || null]);
  return res.status(202).json({ job: job.rows[0] });
});

router.get("/email/send-jobs", async (_req, res) => {
  const jobs = await pool.query(`SELECT j.*,
    count(r.id)::int AS recipient_count,
    count(r.id) FILTER (WHERE r.status='accepted')::int AS accepted_count,
    count(r.id) FILTER (WHERE r.status='failed')::int AS failed_count
    FROM bi_marketing_send_jobs j LEFT JOIN bi_marketing_send_recipients r ON r.job_id=j.id
    GROUP BY j.id ORDER BY j.created_at DESC LIMIT 100`);
  return res.json({ jobs: jobs.rows });
});

router.post("/email/send-jobs/:id/cancel", async (req, res) => {
  const result = await pool.query(`UPDATE bi_marketing_send_jobs SET status='cancelled',completed_at=NOW()
    WHERE id=$1 AND status IN ('queued','running') RETURNING *`, [req.params.id]);
  if (!result.rowCount) return res.status(409).json({ error: { code: "not_cancellable" } });
  return res.json({ job: result.rows[0] });
});

export default router;
