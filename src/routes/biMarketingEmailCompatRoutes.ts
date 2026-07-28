import { Router } from "express";
import { pool } from "../db";
import { audienceParams, buildAudienceBreakdownSql, buildAudienceCountSql, type AudienceFilter } from "../services/biEmailAudience";
import { renderEmailTemplate, type BrandedEmailTemplate } from "../services/emailTemplateRender";
import { sendgridConfigured } from "../services/biSendgridService";

const router: Router = Router();
const strings = (value: unknown): string[] | undefined => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string") : undefined;
const filterFrom = (value: unknown): AudienceFilter => {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    includeTags: strings(body.tags ?? body.includeTags),
    excludeTags: strings(body.excludeTags),
  };
};
const templateFrom = (value: unknown): BrandedEmailTemplate & { subject: string } => {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string): string => typeof body[key] === "string" ? body[key] as string : "";
  return { subject: text("subject"), headline: text("headline"), heroUrl: text("heroUrl"),
    body: text("body"), ctaLabel: text("ctaLabel"), ctaUrl: text("ctaUrl") };
};

router.get("/email/segments", async (_req, res) => {
  try {
    // Composer segments are contact tags, not saved sequence lists. Keep this
    // eligibility predicate aligned with biEmailAudience so displayed counts
    // describe contacts that can actually receive a send.
    const [totalResult, segmentsResult] = await Promise.all([
      pool.query(buildAudienceCountSql(), audienceParams({})),
      pool.query(`SELECT lower(trim(tag)) AS tag, count(DISTINCT c.id)::int AS n
        FROM bi_contacts c
        CROSS JOIN LATERAL unnest(c.tags) AS tag
        WHERE c.email IS NOT NULL AND position('@' in c.email) > 1
          AND c.marketing_consent_basis IS NOT NULL
          AND (c.marketing_consent_expires_at IS NULL OR c.marketing_consent_expires_at > NOW())
          AND NOT EXISTS (
            SELECT 1 FROM bi_suppressions s
            WHERE lower(s.email) = lower(c.email) AND s.channel IN ('email', 'all')
          )
          AND trim(tag) <> ''
        GROUP BY lower(trim(tag))
        ORDER BY lower(trim(tag))`),
    ]);
    return res.json({
      configured: sendgridConfigured(),
      all: totalResult.rows[0]?.count || 0,
      segments: segmentsResult.rows,
    });
  } catch (error) {
    // A database fault must not masquerade as missing SendGrid credentials.
    return res.status(500).json({ configured: sendgridConfigured(), all: 0, segments: [], error: "segments_query_failed" });
  }
});

router.get("/email/audience-count", async (req, res) => {
  const filter = filterFrom(req.query);
  const [count, breakdown] = await Promise.all([
    pool.query(buildAudienceCountSql(), audienceParams(filter)), pool.query(buildAudienceBreakdownSql()),
  ]);
  const row = breakdown.rows[0] || {};
  const total = count.rows[0]?.count || 0;
  return res.json({ n: total, eligible: total, breakdown: {
    withEmail: row.with_email || 0, suppressed: row.suppressed || 0,
    noConsentRecorded: row.no_consent_recorded || 0, consentExpired: row.consent_expired || 0,
  }, sendgridConfigured: sendgridConfigured() });
});

router.get("/email/template", async (_req, res) => {
  const result = await pool.query(`SELECT id,name,subject,body_text,body_html,updated_at
    FROM bi_email_templates WHERE name='Branded email composer' AND is_active=TRUE
    ORDER BY updated_at DESC LIMIT 1`);
  const row = result.rows[0];
  if (!row) return res.json({ template: null });
  let template: unknown = {};
  try { template = JSON.parse(row.body_text || "{}"); } catch { template = {}; }
  return res.json({ template: { id: row.id, subject: row.subject || "", ...(template as object), updatedAt: row.updated_at } });
});

router.post("/email/template", async (req, res) => {
  const template = templateFrom(req.body);
  const html = renderEmailTemplate(template);
  const saved = await pool.query(`INSERT INTO bi_email_templates(name,subject,body_text,body_html,category,created_by)
    VALUES('Branded email composer',$1,$2,$3,'marketing',$4) RETURNING id,created_at,updated_at`,
    [template.subject, JSON.stringify(template), html, (req as any).user?.id || null]);
  return res.status(201).json({ template: { ...template, ...saved.rows[0] } });
});

router.post("/email/template/preview", (req, res) => {
  const template = templateFrom(req.body);
  return res.json({ subject: template.subject, html: renderEmailTemplate(template) });
});

router.post("/email/send-template", async (req, res) => {
  if (!sendgridConfigured()) return res.status(503).json({ error: { code: "sendgrid_not_configured" } });
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const template = templateFrom(body);
  if (!template.subject) return res.status(400).json({ error: { code: "subject_required" } });
  const hold = Math.max(0, Number(process.env.BI_SEND_HOLD_MINUTES || 2));
  const job = await pool.query(`INSERT INTO bi_marketing_send_jobs(subject,html,text_body,filters,scheduled_at,created_by)
    VALUES($1,$2,$3,$4::jsonb,NOW()+($5 * interval '1 minute'),$6) RETURNING *`, [
    template.subject, renderEmailTemplate(template), template.body || null,
    JSON.stringify(filterFrom(body)), hold, (req as any).user?.id || null,
  ]);
  return res.status(202).json({ job: job.rows[0] });
});

router.get("/send-jobs/:id", async (req, res) => {
  const result = await pool.query(`SELECT j.*,count(r.id)::int AS recipient_count,
    count(r.id) FILTER (WHERE r.status='accepted')::int AS accepted_count,
    count(r.id) FILTER (WHERE r.status='failed')::int AS failed_count
    FROM bi_marketing_send_jobs j LEFT JOIN bi_marketing_send_recipients r ON r.job_id=j.id
    WHERE j.id=$1 GROUP BY j.id`, [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: { code: "send_job_not_found" } });
  return res.json({ job: result.rows[0] });
});

router.post("/send-jobs/:id/cancel", async (req, res) => {
  const result = await pool.query(`UPDATE bi_marketing_send_jobs SET status='cancelled',completed_at=NOW()
    WHERE id=$1 AND status IN ('queued','running') RETURNING *`, [req.params.id]);
  if (!result.rowCount) return res.status(409).json({ error: { code: "not_cancellable" } });
  return res.json({ job: result.rows[0] });
});

export default router;
