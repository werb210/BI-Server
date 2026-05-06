import { Router } from "express";
import crypto from "node:crypto";
import { pool } from "../db";
import { pgiScore } from "../services/pgiAdapter";
import { generatePublicId } from "../util/publicId";

const router = Router();
const EBITDA_MIN = 50_000;

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
  const scoreReq = ["country","naics_code","formation_date","loan_amount","pgi_limit","annual_revenue","ebitda","total_debt","monthly_debt_service","collateral_value","enterprise_value"];
  const missing = scoreReq.filter((k) => b[k] === undefined || b[k] === "");
  if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });
  if (b.country !== "CA") return res.status(400).json({ error: "country_unsupported", supported: ["CA"] });
  if (Number(b.ebitda) < EBITDA_MIN) return res.status(400).json({ error: "ebitda_below_min", min: EBITDA_MIN });

  const score = await pgiScore({
    country: b.country, naics_code: b.naics_code,
    formation_date: b.formation_date,
    loan_amount: Number(b.loan_amount), pgi_limit: Number(b.pgi_limit),
    annual_revenue: Number(b.annual_revenue), ebitda: Number(b.ebitda),
    total_debt: Number(b.total_debt),
    monthly_debt_service: Number(b.monthly_debt_service),
    collateral_value: Number(b.collateral_value),
    enterprise_value: Number(b.enterprise_value),
  });

  if (score.decision === "decline") {
    return res.status(422).json({
      error: "score_declined",
      reason: ("reason" in score) ? score.reason : null,
      score_id: score.score_id,
    });
  }

  const id = crypto.randomUUID();
  const publicId = generatePublicId();
  // BI_SERVER_BLOCK_v172_SOURCE_TYPE_NORMALIZE_v1
  // Set source_type explicitly to 'lender' (not the legacy 'lender_api')
  // so it matches V1 ruling 5 and stays aligned with the source column.
  await pool.query(`INSERT INTO bi_applications
       (id, public_id, status, source, source_type, lender_id,
        guarantor_name, guarantor_email, business_name, lender_name,
        country, naics_code, formation_date, loan_amount, pgi_limit,
        annual_revenue, ebitda, total_debt, monthly_debt_service,
        collateral_value, enterprise_value,
        bankruptcy_history, insolvency_history, judgment_history,
        score_id, score_value, score_decision, score_at,
        form_data, created_at, updated_at)
     VALUES ($1,$2,'ready_for_submission','lender','lender',$3,
             $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,NOW(),$25,NOW(),NOW())`,
    [id, publicId, req.lenderId,
     b.guarantor_name, b.guarantor_email, b.business_name, b.lender_name ?? null,
     b.country, b.naics_code, b.formation_date, b.loan_amount, b.pgi_limit,
     b.annual_revenue, b.ebitda, b.total_debt, b.monthly_debt_service,
     b.collateral_value, b.enterprise_value,
     Boolean(b.bankruptcy_history), Boolean(b.insolvency_history), Boolean(b.judgment_history),
     score.score_id, ("score" in score) ? score.score : null, score.decision,
     b]);
  return res.status(201).json({
    public_id: publicId,
    application_id: id,
    status: "ready_for_submission",
    score_id: score.score_id,
    score: "score" in score ? score.score : null,
  });
});

router.get("/lender/applications", authLender, async (req: any, res) => {
  const r = await pool.query(`SELECT id, status, business_name, loan_amount, pgi_limit, annual_premium, quote_id, underwriter_ref, created_at, updated_at FROM bi_applications WHERE lender_id=$1 ORDER BY updated_at DESC LIMIT 200`, [req.lenderId]);
  return res.json({ applications: r.rows });
});

export default router;
