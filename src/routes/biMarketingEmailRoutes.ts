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

// BI_SERVER_SEND_TEMPLATE_SINGLE_HANDLER_v2
// A second POST /email/send-template handler lived here. Both this router and
// biMarketingEmailCompatRoutes are mounted on /api/v1/bi/marketing, so the two
// registrations collided and Express resolved it by registration order alone -
// compat is mounted first, so this one was unreachable.
//
// That mattered because THIS handler never read `body.test`. The composer's
// "Send test" button posts { test: "someone@example.com", ...template }. Compat
// intercepts it, sends one email and returns. This one would have ignored the
// field entirely, and since the composer sends no `filters` key,
// filterFrom(body.filters) yielded no include/exclude tags at all - meaning the
// full eligible audience, ~3,983 contacts, from a button labelled "Send test".
//
// It was also dead on its own terms: it requires body.templateId, and the only
// caller in the estate (BF-portal BrandedEmailComposer) posts a composer
// payload with no templateId, so reaching it would have returned 400
// template_id_required rather than working.
//
// Removed rather than fixed. Two handlers for one route is the defect; leaving
// a corrected duplicate in place would keep the estate one mount-order edit
// away from the same blast. /email/audience-count (POST here, GET on compat),
// /email/send-jobs and /email/send-jobs/:id/cancel are NOT duplicated and stay.

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
