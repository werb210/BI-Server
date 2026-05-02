import crypto from "node:crypto";
import { Router } from "express";
import { pool } from "../db";

const router = Router();

router.post("/applications", async (req, res) => {
  // BI_BLOCK_PGI_ALIGNMENT_v1
  const b = req.body ?? {};
  const required = ["guarantor_name","guarantor_email","business_name","country","naics_code","formation_date","loan_amount","pgi_limit","annual_revenue","ebitda","total_debt","monthly_debt_service","collateral_value","enterprise_value","bankruptcy_history","insolvency_history","judgment_history"];
  const missing = required.filter((k) => b[k] === undefined || b[k] === "");
  if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });
  if (Number(b.pgi_limit) > Number(b.loan_amount)) return res.status(400).json({ error: "pgi_limit_exceeds_loan" });
  if (Number(b.pgi_limit) > Number(b.loan_amount) * 0.80) return res.status(400).json({ error: "pgi_limit_exceeds_80pct" });
  if (Number(b.loan_amount) > 1_000_000) return res.status(400).json({ error: "loan_amount_exceeds_max", max: 1_000_000 });

  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO bi_applications
       (id, status, source,
        guarantor_name, guarantor_email, business_name, lender_name,
        country, naics_code, formation_date, loan_amount, pgi_limit,
        annual_revenue, ebitda, total_debt, monthly_debt_service,
        collateral_value, enterprise_value,
        bankruptcy_history, insolvency_history, judgment_history,
        facility_type, coverage_percentage, form_data,
        created_at, updated_at)
     VALUES ($1,'document_review','public',
             $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
             $17,$18,$19,$20,$21,$22, NOW(), NOW())`,
    [id, b.guarantor_name, b.guarantor_email, b.business_name, b.lender_name ?? null,
     b.country, b.naics_code, b.formation_date, b.loan_amount, b.pgi_limit,
     b.annual_revenue, b.ebitda, b.total_debt, b.monthly_debt_service,
     b.collateral_value, b.enterprise_value,
     Boolean(b.bankruptcy_history), Boolean(b.insolvency_history), Boolean(b.judgment_history),
     b.facility_type ?? null, b.coverage_percentage ?? null, b]);
  return res.status(201).json({ application_id: id, status: "document_review" });
});

export default router;
