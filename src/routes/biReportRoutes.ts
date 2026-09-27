import { Router } from "express";
import { Pool } from "pg";
import { env } from "../platform/env";

import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const pool = new Pool({ connectionString: env.DATABASE_URL });

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

export default router;
