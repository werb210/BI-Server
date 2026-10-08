import { Router } from "express";
import { pool as sharedPool } from "../db"; // BI_SERVER_ONE_POOL_v718 - one pool for the whole server
import { env } from "../platform/env";

import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const pool = sharedPool /* BI_SERVER_ONE_POOL_v718 */;

/* =========================
   BI REPORT SUMMARY
========================= */
router.get("/reports/summary", async (_req, res) => {
  // Total applications
  const totalApps = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM bi_applications
  `);

  // Policies issued
  const issued = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM bi_applications
    WHERE stage = 'policy_issued'
  `);

  // Premium volume (sum of annual premium)
  const premiumVolume = await pool.query(`
    SELECT COALESCE(SUM(annual_premium_amount),0)::numeric AS total
    FROM bi_commissions
  `);

  // Commission outstanding (payable but not paid)
  const commissionOutstanding = await pool.query(`
    SELECT COALESCE(SUM(commission_amount),0)::numeric AS total
    FROM bi_commissions
    WHERE status = 'payable'
  `);

  // BI_SERVER_BLOCK_v595_COMMISSIONS_BY_CURRENCY - the same two figures, kept apart by currency.
  const byCurrency = await pool.query(`
    SELECT CASE WHEN UPPER(TRIM(COALESCE(a.country, ''))) IN ('US', 'USA', 'UNITED STATES') THEN 'USD' ELSE 'CAD' END AS currency,
           COALESCE(SUM(c.annual_premium_amount), 0)::numeric AS premium,
           COALESCE(SUM(c.commission_amount) FILTER (WHERE c.status = 'payable'), 0)::numeric AS outstanding
      FROM bi_commissions c
      LEFT JOIN bi_applications a ON a.id = c.application_id
     GROUP BY 1
  `);
  const premiumVolumeByCurrency: Record<string, number> = {};
  const commissionOutstandingByCurrency: Record<string, number> = {};
  for (const r of byCurrency.rows ?? []) {
    premiumVolumeByCurrency[r.currency] = Number(r.premium ?? 0);
    commissionOutstandingByCurrency[r.currency] = Number(r.outstanding ?? 0);
  }

  // Referral count
  const referrals = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM bi_referrals
  `);

  // Lender count
  const lenders = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM bi_lenders
  `);

  // Claims ratio placeholder
  // Since BI doesn't adjudicate claims, we approximate:
  const enforcementDocs = await pool.query(`
    SELECT COUNT(DISTINCT application_id)::int AS count
    FROM bi_documents
    WHERE doc_type = 'enforcement_notice'
      AND purged_at IS NULL
  `);

  const totalApplications = Number(totalApps.rows?.[0]?.count ?? 0);
  const totalIssued = Number(issued.rows?.[0]?.count ?? 0);
  const claimCount = Number(enforcementDocs.rows?.[0]?.count ?? 0);

  const claimsRatio =
    totalIssued > 0 ? Number(((claimCount / totalIssued) * 100).toFixed(2)) : 0;

  const conversionRate =
    totalApplications > 0 ? Number(((totalIssued / totalApplications) * 100).toFixed(2)) : 0;

  ok(res, {
    totalApplications,
    policiesIssued: totalIssued,
    conversionRate,
    premiumVolume: Number(premiumVolume.rows?.[0]?.total ?? 0),
    commissionOutstanding: Number(commissionOutstanding.rows?.[0]?.total ?? 0),
    premiumVolumeByCurrency, // BI_SERVER_BLOCK_v595
    commissionOutstandingByCurrency,
    claimsRatio,
    referralCount: Number(referrals.rows?.[0]?.count ?? 0),
    lenderCount: Number(lenders.rows?.[0]?.count ?? 0)
  });
});

/* =========================
   BI_SERVER_INSURANCE_REPORTS_v717 - Insurance reports for the staff portal's Reports page: referrals by referrer,
   carrier turnaround (submitted to decision, from the stage-change activity log) and premium by month by currency.
========================= */
export function reportDays(v: unknown, fallback = 365): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1095) : fallback;
}
router.get("/reports/insurance", async (req, res) => {
  const days = reportDays(req.query?.days);
  try {
    const referrers = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(COALESCE(r.full_name, TRIM(COALESCE(r.first_name, '') || ' ' || COALESCE(r.last_name, '')))), ''), NULLIF(r.company_name, ''), 'No referrer') AS label,
              count(*)::int AS applications,
              count(*) FILTER (WHERE a.stage::text = 'policy_issued')::int AS policies,
              COALESCE(sum(a.annual_premium) FILTER (WHERE a.stage::text = 'policy_issued'), 0)::numeric AS premium,
              COALESCE(sum(a.boreal_commission) FILTER (WHERE a.stage::text = 'policy_issued'), 0)::numeric AS commission
         FROM bi_applications a LEFT JOIN bi_referrers r ON r.id = a.referrer_id
        WHERE a.created_at >= now() - ($1 || ' days')::interval AND COALESCE(a.is_demo, false) = false
        GROUP BY 1 ORDER BY 2 DESC LIMIT 25`, [days]);
    const turnaround = await pool.query(
      `WITH s AS (
         SELECT application_id,
                min(created_at) FILTER (WHERE COALESCE(meta->>'stage', meta->>'to') = 'submitted') AS submitted_at,
                min(created_at) FILTER (WHERE COALESCE(meta->>'stage', meta->>'to') IN ('approved', 'declined', 'policy_issued')) AS decided_at
           FROM bi_activity WHERE event_type IN ('stage_change', 'application_stage_changed') AND application_id IS NOT NULL
          GROUP BY application_id)
       SELECT to_char(date_trunc('month', submitted_at), 'YYYY-MM') AS label, count(*)::int AS submitted,
              count(*) FILTER (WHERE decided_at > submitted_at)::int AS decided,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (decided_at - submitted_at)) / 86400) FILTER (WHERE decided_at > submitted_at) AS median_days
         FROM s WHERE submitted_at >= now() - ($1 || ' days')::interval
        GROUP BY 1 ORDER BY 1`, [days]);
    const premium = await pool.query(
      `SELECT to_char(date_trunc('month', COALESCE(c.premium_received_at, c.created_at)), 'YYYY-MM') AS label,
              CASE WHEN UPPER(TRIM(COALESCE(a.country, ''))) IN ('US', 'USA', 'UNITED STATES') THEN 'USD' ELSE 'CAD' END AS currency,
              count(*)::int AS policies, COALESCE(sum(c.annual_premium_amount), 0)::numeric AS premium, COALESCE(sum(c.commission_amount), 0)::numeric AS commission
         FROM bi_commissions c LEFT JOIN bi_applications a ON a.id = c.application_id
        WHERE COALESCE(c.premium_received_at, c.created_at) >= now() - ($1 || ' days')::interval
        GROUP BY 1, 2 ORDER BY 1, 2`, [days]);
    const money = (v: unknown) => Math.round(Number(v ?? 0));
    return ok(res, {
      days,
      note: "Turnaround counts from the first move to Submitted to the first decision (approved, declined or policy issued).",
      referrers: referrers.rows.map((r: any) => ({ label: r.label, applications: r.applications, policies: r.policies, premium: money(r.premium), commission: money(r.commission) })),
      turnaround: turnaround.rows.map((r: any) => ({ label: r.label, submitted: r.submitted, decided: r.decided, median_days: r.median_days === null ? null : Math.round(Number(r.median_days) * 10) / 10 })),
      premium: premium.rows.map((r: any) => ({ label: r.label, currency: r.currency, policies: r.policies, premium: money(r.premium), commission: money(r.commission) })),
    });
  } catch (err: unknown) {
    console.error("[bi-reports] insurance report failed", err instanceof Error ? err.message : String(err));
    return res.status(500).json({ ok: false, error: "report_failed" });
  }
});

export default router;
