import { Router } from "express";
import { Pool } from "pg";
import { env } from "../platform/env";

import { ok } from "../utils/apiResponse";

const router = Router();
const db = new Pool({ connectionString: env.DATABASE_URL });

router.get("/", async (_req, res) => {

  const result = await db.query(`
    SELECT *
    FROM bi_commissions
    ORDER BY created_at DESC
  `);

  ok(res, result.rows);

});

router.get("/by-application/:id", async (req, res) => {
  const result = await db.query(
    `SELECT * FROM bi_commissions WHERE application_id=$1 LIMIT 1`,
    [req.params.id]
  );
  return ok(res, result.rows[0] ?? null);
});

// BI_SERVER_BLOCK_v595_COMMISSIONS_BY_CURRENCY
// Commission reporting, kept apart by currency: a US policy (bi_applications.country = US)
// is USD, everything else CAD. Nothing is converted here - the portal converts USD to CAD
// with the Bank of Canada rate BF-Server already keeps, so both silos use one rate.
router.get("/summary", async (_req, res) => {
  const result = await db.query(
    `SELECT c.id, c.application_id, a.business_name, a.application_code, c.status::text AS status,
            c.annual_premium_amount, c.commission_amount, c.commission_rate,
            c.created_at, c.premium_received_at, c.paid_at,
            CASE WHEN UPPER(TRIM(COALESCE(a.country, ''))) IN ('US', 'USA', 'UNITED STATES') THEN 'USD' ELSE 'CAD' END AS currency
       FROM bi_commissions c
       LEFT JOIN bi_applications a ON a.id = c.application_id
      WHERE c.status::text <> 'void'
      ORDER BY c.created_at DESC
      LIMIT 500`,
  );
  ok(res, summarizeCommissions(result.rows));
});

export type CommissionRow = {
  status: string; currency: string;
  annual_premium_amount: string | number | null; commission_amount: string | number | null;
};
export type MoneyByCurrency = Record<string, { premium: number; commission: number; count: number }>;

export function summarizeCommissions<T extends CommissionRow>(rows: T[]): { byStatus: Record<string, MoneyByCurrency>; totals: MoneyByCurrency; rows: T[] } {
  const byStatus: Record<string, MoneyByCurrency> = {};
  const totals: MoneyByCurrency = {};
  const add = (bucket: MoneyByCurrency, cur: string, premium: number, commission: number) => {
    const b = (bucket[cur] ??= { premium: 0, commission: 0, count: 0 });
    b.premium = Math.round((b.premium + premium) * 100) / 100;
    b.commission = Math.round((b.commission + commission) * 100) / 100;
    b.count += 1;
  };
  for (const r of rows) {
    const cur = r.currency === "USD" ? "USD" : "CAD";
    const premium = Number(r.annual_premium_amount ?? 0) || 0;
    const commission = Number(r.commission_amount ?? 0) || 0;
    add((byStatus[r.status] ??= {}), cur, premium, commission);
    add(totals, cur, premium, commission);
  }
  return { byStatus, totals, rows };
}

// BI_SERVER_BLOCK_v595 - 'received' is not a bi_commission_status value, so this update
// failed every time. The premium arriving makes the commission payable.
router.post("/:id/premium-received", async (req, res) => {
  const { id } = req.params;
  await db.query(
    `UPDATE bi_commissions
        SET status = 'payable',
            premium_received_at = COALESCE(premium_received_at, NOW()),
            updated_at = NOW()
      WHERE id = $1`,
    [id]
  );
  ok(res, { success: true });
});

// BI_SERVER_BLOCK_v595 - record that the commission has been paid to Boreal.
router.post("/:id/paid", async (req, res) => {
  await db.query(
    `UPDATE bi_commissions SET status = 'paid', paid_at = COALESCE(paid_at, NOW()), updated_at = NOW() WHERE id = $1`,
    [req.params.id],
  );
  ok(res, { success: true });
});

export default router;
