import { Router } from "express";
import crypto from "node:crypto";
import { pool } from "../db";
import { pgiScore } from "../services/pgiAdapter";
import { generatePublicId } from "../util/publicId";

const router = Router();
const EBITDA_MIN = 50_000;
const LOAN_MAX = 1_000_000;

router.post("/applications/score", async (req, res) => {
  const b = req.body ?? {};
  const required = [
    "country", "naics_code", "formation_date", "loan_amount", "pgi_limit",
    "annual_revenue", "ebitda", "total_debt", "monthly_debt_service",
    "collateral_value", "enterprise_value",
  ];
  const missing = required.filter((k) => b[k] === undefined || b[k] === "");
  if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });

  if (b.country !== "CA") return res.status(400).json({ error: "country_unsupported", supported: ["CA"] });
  if (Number(b.loan_amount) > LOAN_MAX) return res.status(400).json({ error: "loan_amount_exceeds_max", max: LOAN_MAX });
  if (Number(b.pgi_limit) > Number(b.loan_amount)) return res.status(400).json({ error: "pgi_limit_exceeds_loan" });
  if (Number(b.pgi_limit) > Number(b.loan_amount) * 0.80) return res.status(400).json({ error: "pgi_limit_exceeds_80pct" });
  if (Number(b.ebitda) < EBITDA_MIN) return res.status(400).json({ error: "ebitda_below_min", min: EBITDA_MIN });

  const id = crypto.randomUUID();
  const publicId = generatePublicId();

  await pool.query(
    `INSERT INTO bi_applications
       (id, public_id, status, source,
        country, naics_code, formation_date, loan_amount, pgi_limit,
        annual_revenue, ebitda, total_debt, monthly_debt_service,
        collateral_value, enterprise_value,
        created_at, updated_at)
     VALUES ($1,$2,'in_progress','public',
             $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW(), NOW())`,
    [
      id, publicId,
      b.country, b.naics_code, b.formation_date, b.loan_amount, b.pgi_limit,
      b.annual_revenue, b.ebitda, b.total_debt, b.monthly_debt_service,
      b.collateral_value, b.enterprise_value,
    ],
  );

  let score;
  try {
    score = await pgiScore({
      country: b.country,
      naics_code: b.naics_code,
      formation_date: b.formation_date,
      loan_amount: Number(b.loan_amount),
      pgi_limit: Number(b.pgi_limit),
      annual_revenue: Number(b.annual_revenue),
      ebitda: Number(b.ebitda),
      total_debt: Number(b.total_debt),
      monthly_debt_service: Number(b.monthly_debt_service),
      collateral_value: Number(b.collateral_value),
      enterprise_value: Number(b.enterprise_value),
    });
  } catch (err: any) {
    await pool.query(
      `UPDATE bi_applications SET score_decision='error', score_reason=$1, score_at=NOW() WHERE id=$2`,
      [String(err?.message ?? "pgi_unreachable"), id],
    );
    return res.status(502).json({ error: "score_failed", public_id: publicId });
  }

  const newStatus = score.decision === "decline" ? "declined" : "in_progress";
  await pool.query(
    `UPDATE bi_applications
        SET score_id=$1, score_value=$2, score_decision=$3, score_reason=$4,
            score_at=NOW(), score_stale=FALSE, status=$5, updated_at=NOW()
      WHERE id=$6`,
    [
      score.score_id,
      "score" in score ? score.score : null,
      score.decision,
      "reason" in score ? score.reason : null,
      newStatus,
      id,
    ],
  );

  return res.status(201).json({
    public_id: publicId,
    score_decision: score.decision,
    score: "score" in score ? score.score : null,
    reason: "reason" in score ? score.reason : null,
  });
});

router.get("/applications/:publicId", async (req, res) => {
  const r = await pool.query(`SELECT * FROM bi_applications WHERE public_id=$1`, [req.params.publicId]);
  if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
  return res.json({ application: r.rows[0] });
});

router.patch("/applications/:publicId", async (req, res) => {
  const r = await pool.query(`SELECT id, score_decision FROM bi_applications WHERE public_id=$1`, [req.params.publicId]);
  if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
  if (r.rows[0].score_decision !== "approve") return res.status(403).json({ error: "score_not_approved" });

  const b = req.body ?? {};
  const cols: Record<string, string> = {
    guarantor_name: "guarantor_name",
    guarantor_email: "guarantor_email",
    guarantor_dob: "guarantor_dob",
    guarantor_address: "guarantor_address",
    guarantor_phone: "guarantor_phone",
    business_name: "business_name",
    business_address: "business_address",
    business_website: "business_website",
    entity_type: "entity_type",
    business_number: "business_number",
    lender_name: "lender_name",
    csbfp_backed: "csbfp_backed",
    loan_has_guaranteed_cap: "loan_has_guaranteed_cap",
    loan_funding_date: "loan_funding_date",
    loan_purpose: "loan_purpose",
    personally_guaranteeing: "personally_guaranteeing",
    has_other_guarantors: "has_other_guarantors",
    policy_start_date: "policy_start_date",
    payables_threatening: "payables_threatening",
    upcoming_adverse_events: "upcoming_adverse_events",
    bankruptcy_history: "bankruptcy_history",
    insolvency_history: "insolvency_history",
    judgment_history: "judgment_history",
    personal_investigations: "personal_investigations",
    business_investigations: "business_investigations",
    property_insurance_in_force: "property_insurance_in_force",
    personal_judgments: "personal_judgments",
    business_judgments: "business_judgments",
    consents: "consents",
  };

  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  for (const k of Object.keys(b)) {
    if (cols[k]) {
      sets.push(`${cols[k]} = $${i++}`);
      vals.push(b[k]);
    }
  }
  if (!sets.length) return res.json({ ok: true, no_op: true });
  vals.push(r.rows[0].id);
  await pool.query(`UPDATE bi_applications SET ${sets.join(", ")}, updated_at=NOW() WHERE id=$${i}`, vals);
  return res.json({ ok: true });
});

router.post("/applications/:publicId/submit", async (req, res) => {
  const r = await pool.query(`SELECT * FROM bi_applications WHERE public_id=$1`, [req.params.publicId]);
  const app = r.rows[0];
  if (!app) return res.status(404).json({ error: "not_found" });
  if (app.score_decision !== "approve") return res.status(403).json({ error: "score_not_approved" });
  if (app.score_stale) return res.status(409).json({ error: "score_stale", remediation: "re_run_score" });

  const required = [
    "guarantor_name", "guarantor_email", "guarantor_dob", "guarantor_address",
    "guarantor_phone", "business_name", "business_address", "entity_type",
    "business_number", "lender_name", "loan_purpose", "loan_funding_date",
    "policy_start_date", "bankruptcy_history", "insolvency_history",
    "judgment_history", "personal_judgments", "business_judgments",
    "personally_guaranteeing", "consents",
  ];
  const missing = required.filter((k) => app[k] === null || app[k] === undefined || app[k] === "");
  if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });

  const c = app.consents ?? {};
  const consentKeys = [
    "electronic_signature", "info_accurate", "business_solvent",
    "no_undisclosed_events", "data_use", "credit_pull", "coverage_understood",
  ];
  const unconsented = consentKeys.filter((k) => !c[k]);
  if (unconsented.length) return res.status(400).json({ error: "missing_consents", fields: unconsented });

  await pool.query(`UPDATE bi_applications SET status='document_review', updated_at=NOW() WHERE id=$1`, [app.id]);
  return res.json({ ok: true, status: "document_review" });
});

export default router;
