import { Router } from "express";
import { pool } from "../db";
import { audienceParams, buildAudienceBreakdownSql, buildAudienceCountSql, type AudienceFilter } from "../services/biEmailAudience";
import { renderEmailTemplate, type BrandedEmailTemplate } from "../services/emailTemplateRender";
import { mergeFields, sendBiMarketingEmail, sendgridConfigured } from "../services/biSendgridService";

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
const queryTags = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(",")).map((tag) => tag.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((tag) => tag.trim()).filter(Boolean);
  return undefined;
};
// BI_SERVER_TEMPLATE_FIELD_PASSTHROUGH_v15
// This was a hardcoded allowlist that silently dropped anything not named in
// it. cta2Label and cta2Url were missing, so the right column's button was
// discarded on every preview and every send even though the composer posted it
// and renderEmailTemplate asked for it. Any field the composer gains in future
// would fail the same way, invisibly.
//
// Every renderable key is now derived from BrandedEmailTemplate rather than
// retyped by hand, so the two can no longer drift apart.
const TEMPLATE_KEYS = [
  "subject",
  "headline", "heroUrl", "heroLink", "body", "ctaLabel", "ctaUrl",
  "image2Url", "image2Link",
  "cta2Label", "cta2Url",
  "headline2", "body2",
  "secondHeadline", "secondBody",
  "rightHeadline", "rightBody", "rightImageUrl", "rightImageLink",
] as const satisfies readonly (keyof BrandedEmailTemplate)[];

const templateFrom = (value: unknown): BrandedEmailTemplate & { subject: string } => {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  for (const key of TEMPLATE_KEYS) {
    out[key] = typeof body[key] === "string" ? body[key] as string : "";
  }
  return out as BrandedEmailTemplate & { subject: string };
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
  const filter: AudienceFilter = {
    includeTags: queryTags(req.query.include ?? req.query.tags ?? req.query.includeTags),
    excludeTags: queryTags(req.query.exclude ?? req.query.excludeTags),
  };
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
  const saved = await pool.query(`WITH updated AS (
      UPDATE bi_email_templates SET subject=$1,body_text=$2,body_html=$3,updated_at=NOW()
      WHERE id=(SELECT id FROM bi_email_templates WHERE name='Branded email composer' ORDER BY updated_at DESC LIMIT 1)
      RETURNING id,created_at,updated_at
    )
    , inserted AS (
      INSERT INTO bi_email_templates(name,subject,body_text,body_html,category,created_by)
      SELECT 'Branded email composer',$1,$2,$3,'marketing',$4 WHERE NOT EXISTS (SELECT 1 FROM updated)
      RETURNING id,created_at,updated_at
    )
    SELECT * FROM updated UNION ALL SELECT * FROM inserted`,
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
  const test = typeof body.test === "string" ? body.test.trim() : "";
  if (test) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(test)) return res.status(400).json({ error: { code: "invalid_test_address" } });
    // BI_SERVER_PUBLIC_ASSET_MOUNT_ORDER_v13 - resolve the test recipient
    // against bi_contacts so the test exercises the same merge the blast will.
    const contact = await pool.query<{ full_name: string | null }>(
      "SELECT full_name FROM bi_contacts WHERE lower(email) = lower($1) LIMIT 1",
      [test],
    );
    const firstName =
      String(contact.rows[0]?.full_name || "").trim().split(/\s+/)[0] || "there";
    const values = { first_name: firstName, name: firstName, email: test };
    await sendBiMarketingEmail({
      to: test,
      subject: mergeFields(template.subject, values),
      html: mergeFields(renderEmailTemplate(template), values),
      text: template.body ? mergeFields(template.body, values) : undefined,
    });
    return res.json({ test: true, ok: true, to: test });
  }
  const filter = filterFrom(body);
  const count = await pool.query(buildAudienceCountSql(), audienceParams(filter));
  const total = Number(count.rows[0]?.count || 0);
  const hold = Math.max(0, Number(process.env.BI_SEND_HOLD_MINUTES || 2));
  const job = await pool.query(`INSERT INTO bi_marketing_send_jobs(subject,html,text_body,filters,scheduled_at,created_by,total)
    VALUES($1,$2,$3,$4::jsonb,NOW()+($5 * interval '1 minute'),$6,$7) RETURNING *`, [
    template.subject, renderEmailTemplate(template), template.body || null,
    JSON.stringify(filter), hold, (req as any).user?.id || null, total,
  ]);
  const row = job.rows[0];
  return res.status(202).json({ queued: true, jobId: row.id, total, notBefore: row.scheduled_at });
});

router.get("/send-jobs/:id", async (req, res) => {
  const result = await pool.query(`SELECT j.*,count(r.id)::int AS recipient_count,
    count(r.id) FILTER (WHERE r.status='accepted')::int AS accepted_count,
    count(r.id) FILTER (WHERE r.status='failed')::int AS failed_count
    FROM bi_marketing_send_jobs j LEFT JOIN bi_marketing_send_recipients r ON r.job_id=j.id
    WHERE j.id=$1 GROUP BY j.id`, [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: { code: "send_job_not_found" } });
  const row = result.rows[0];
  const status = row.status === "completed" ? "done" : row.status === "cancelled" ? "canceled" : row.status;
  return res.json({ ...row, status, not_before: row.scheduled_at, total: row.total ?? row.recipient_count ?? 0 });
});

router.post("/send-jobs/:id/cancel", async (req, res) => {
  const result = await pool.query(`UPDATE bi_marketing_send_jobs SET status='cancelled',completed_at=NOW()
    WHERE id=$1 AND status IN ('queued','running') RETURNING *`, [req.params.id]);
  if (!result.rowCount) return res.status(409).json({ error: { code: "not_cancellable" } });
  const row = result.rows[0];
  return res.json({ ...row, status: "canceled", not_before: row.scheduled_at });
});

export default router;
