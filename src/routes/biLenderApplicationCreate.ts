// BI_SERVER_BLOCK_v213_LENDER_APPLICATIONS_POST_v1
import express, { type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db";

const router = express.Router();

function genCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function getLenderId(req: Request): string | null {
  const auth = req.header("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(m[1], secret) as any;
    if (payload?.kind !== "lender" || !payload?.id) return null;
    return String(payload.id);
  } catch {
    return null;
  }
}

router.post("/api/v1/lender/applications", async (req: Request, res: Response) => {
  const lenderId = getLenderId(req);
  if (!lenderId) return res.status(401).json({ error: "unauthorized", message: "Valid lender Bearer token required" });

  const b = req.body || {};
  const required: Array<[string, any]> = [
    ["company_name", b.company_name],
    ["guarantor.name", b.guarantor?.name],
    ["guarantor.phone", b.guarantor?.phone],
    ["business.naics", b.business?.naics],
    ["business.start_date", b.business?.start_date],
    ["loan.amount", b.loan?.amount],
    ["loan.pgi_limit", b.loan?.pgi_limit],
    ["loan.estimated_close_date", b.loan?.estimated_close_date],
    ["financials.revenue_last_year", b.financials?.revenue_last_year],
    ["financials.ebitda_last_year", b.financials?.ebitda_last_year],
  ];
  const missing = required.filter(([_, v]) => v === undefined || v === null || v === "").map(([k]) => k);
  if (missing.length > 0) return res.status(400).json({ error: "validation", missing });

  const applicationCode = genCode();
  const coreInputs = {
    country: b.business?.country || "CA",
    naics: b.business?.naics,
    business_start_date: b.business?.start_date,
    loan_amount: num(b.loan?.amount),
    pgi_limit: num(b.loan?.pgi_limit),
    use_of_proceeds: b.loan?.use_of_proceeds || "expansion",
    estimated_close_date: b.loan?.estimated_close_date,
    revenue: num(b.financials?.revenue_last_year),
    ebitda: num(b.financials?.ebitda_last_year),
    total_debt: num(b.financials?.total_debt),
    monthly_payments: num(b.financials?.monthly_payments),
    owner_salary: num(b.financials?.owner_salary),
    cash_on_hand: num(b.financials?.cash_on_hand),
    revenue_projection_next_year: num(b.financials?.revenue_projection_next_year),
  };

  const sql = `
    INSERT INTO bi_applications (
      entity_type, status, source, lender_id,
      application_code, phone,
      company_name, guarantor_name, guarantor_phone, guarantor_email,
      core_inputs, consents, lender_notes,
      created_at, updated_at
    ) VALUES (
      'applicant', 'new_application', 'lender', $1,
      $2, $3,
      $4, $5, $6, $7,
      $8::jsonb, $9::jsonb, $10,
      NOW(), NOW()
    )
    RETURNING id, application_code
  `;
  const params = [
    lenderId,
    applicationCode,
    b.guarantor?.phone,
    b.company_name,
    b.guarantor?.name,
    b.guarantor?.phone,
    b.guarantor?.email || null,
    JSON.stringify(coreInputs),
    JSON.stringify({ data_use: true, credit_pull: true, info_accurate: true, source: "lender_attestation" }),
    b.lender_notes || null,
  ];

  const result = await pool.query(sql, params);
  const row = result.rows[0];
  return res.status(201).json({ ok: true, id: row.id, application_code: row.application_code });
});

export default router;
