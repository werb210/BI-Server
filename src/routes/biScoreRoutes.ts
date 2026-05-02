// BI_BLOCK_PGI_ALIGNMENT_v1 — score + submit-to-pgi handlers.
import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../platform/auth";
import { pgiScore, pgiSubmit } from "../services/pgiAdapter";

const router = Router();

router.post("/applications/:id/score", requireAuth, async (req, res) => {
  const { id } = req.params;
  const r = await pool.query(`SELECT * FROM bi_applications WHERE id = $1`, [id]);
  const app = r.rows[0];
  if (!app) return res.status(404).json({ error: "not_found" });

  try {
    const score = await pgiScore({
      country: app.country, naics_code: app.naics_code,
      formation_date: app.formation_date.toISOString().slice(0, 10),
      loan_amount: Number(app.loan_amount), pgi_limit: Number(app.pgi_limit),
      annual_revenue: Number(app.annual_revenue), ebitda: Number(app.ebitda),
      total_debt: Number(app.total_debt), monthly_debt_service: Number(app.monthly_debt_service),
      collateral_value: Number(app.collateral_value), enterprise_value: Number(app.enterprise_value),
    });

    const isStaffOverridable = app.source === "public";
    let newStatus = app.status;
    if (score.decision === "decline" && !isStaffOverridable) newStatus = "declined";

    await pool.query(`UPDATE bi_applications SET score_id=$1, score_value=$2, score_decision=$3, score_reason=$4, score_at=NOW(), status=$5, updated_at=NOW() WHERE id=$6`, [score.score_id, "score" in score ? score.score : null, score.decision, "reason" in score ? score.reason : null, newStatus, id]);
    return res.json({ score });
  } catch (err: any) {
    await pool.query(`UPDATE bi_applications SET score_decision='error', score_reason=$1, score_at=NOW() WHERE id=$2`, [String(err?.message ?? "unknown"), id]);
    return res.status(502).json({ error: "pgi_score_failed", detail: String(err?.message) });
  }
});

router.post("/applications/:id/submit-to-pgi", requireAuth, async (req, res) => {
  const { id } = req.params;
  const r = await pool.query(`SELECT * FROM bi_applications WHERE id=$1`, [id]);
  const app = r.rows[0];
  if (!app) return res.status(404).json({ error: "not_found" });
  if (app.pgi_application_id) return res.status(409).json({ error: "already_submitted", pgi_application_id: app.pgi_application_id });

  const submit = await pgiSubmit({
    guarantor_name: app.guarantor_name,
    guarantor_email: app.guarantor_email,
    business_name: app.business_name,
    lender_name: app.lender_name ?? undefined,
    form_data: {
      country: app.country, naics_code: app.naics_code,
      formation_date: app.formation_date.toISOString().slice(0, 10),
      loan_amount: Number(app.loan_amount), pgi_limit: Number(app.pgi_limit),
      annual_revenue: Number(app.annual_revenue), ebitda: Number(app.ebitda),
      total_debt: Number(app.total_debt), monthly_debt_service: Number(app.monthly_debt_service),
      collateral_value: Number(app.collateral_value), enterprise_value: Number(app.enterprise_value),
      bankruptcy_history: app.bankruptcy_history, insolvency_history: app.insolvency_history, judgment_history: app.judgment_history,
    },
  });

  await pool.query(`UPDATE bi_applications SET pgi_application_id=$1, status='submitted', updated_at=NOW() WHERE id=$2`, [submit.application_id, id]);
  return res.json({ ok: true, pgi_application_id: submit.application_id, status: "submitted" });
});

export default router;
