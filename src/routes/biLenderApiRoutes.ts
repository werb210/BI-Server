import { Router } from "express";
import crypto from "node:crypto";
import { pool } from "../db";

const router = Router();

async function authLender(req: any, res: any, next: any) {
  const auth = String(req.headers.authorization ?? "");
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!key) return res.status(401).json({ error: "missing_api_key" });
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const r = await pool.query(`SELECT lender_id FROM bi_lender_api_keys WHERE key_hash=$1 AND active=TRUE LIMIT 1`, [hash]);
  const row = r.rows[0];
  if (!row) return res.status(401).json({ error: "invalid_api_key" });
  await pool.query(`UPDATE bi_lender_api_keys SET last_used_at=NOW() WHERE key_hash=$1`, [hash]);
  req.lenderId = row.lender_id;
  next();
}

router.post("/lender/applications", authLender, async (req: any, res) => {
  const b = req.body ?? {};
  const required = ["guarantor_name","guarantor_email","business_name","country","naics_code","formation_date","loan_amount","pgi_limit","annual_revenue","ebitda","total_debt","monthly_debt_service","collateral_value","enterprise_value","bankruptcy_history","insolvency_history","judgment_history"];
  const missing = required.filter((k) => b[k] === undefined || b[k] === "");
  if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });

  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO bi_applications
       (id, status, source, lender_id,
        guarantor_name, guarantor_email, business_name, lender_name,
        country, naics_code, formation_date, loan_amount, pgi_limit,
        annual_revenue, ebitda, total_debt, monthly_debt_service,
        collateral_value, enterprise_value,
        bankruptcy_history, insolvency_history, judgment_history,
        facility_type, coverage_percentage, form_data,
        created_at, updated_at)
     VALUES ($1,'ready_for_submission','lender_api',$2,
             $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
             $18,$19,$20,$21,$22,$23,NOW(),NOW())`,
    [id, req.lenderId, b.guarantor_name, b.guarantor_email, b.business_name, b.lender_name ?? null,
     b.country, b.naics_code, b.formation_date, b.loan_amount, b.pgi_limit, b.annual_revenue, b.ebitda,
     b.total_debt, b.monthly_debt_service, b.collateral_value, b.enterprise_value,
     Boolean(b.bankruptcy_history), Boolean(b.insolvency_history), Boolean(b.judgment_history),
     b.facility_type ?? null, b.coverage_percentage ?? null, b]);
  return res.status(201).json({ application_id: id, status: "ready_for_submission" });
});

router.get("/lender/applications", authLender, async (req: any, res) => {
  const r = await pool.query(`SELECT id, status, business_name, loan_amount, pgi_limit, annual_premium, quote_id, underwriter_ref, created_at, updated_at FROM bi_applications WHERE lender_id=$1 ORDER BY updated_at DESC LIMIT 200`, [req.lenderId]);
  return res.json({ applications: r.rows });
});

export default router;
