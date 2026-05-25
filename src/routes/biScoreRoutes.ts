// BI_BLOCK_PGI_ALIGNMENT_v1 — score + submit-to-pgi handlers.
import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../platform/auth";
import { pgiScore, pgiSubmit } from "../services/pgiAdapter";

const router = Router();

// BI_SERVER_BLOCK_v274_SCORE_ROUTES_NULL_GUARDS_v1
// formation_date may arrive as Date (when column is set), string
// (when read from JSONB / older shapes), or null (BF→BI handoff
// mirrors don't populate the column). Throw a clear error to the
// route handler so we return 400 instead of crashing with TypeError.
function formationDateIsoOrThrow(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && v.length >= 10) return v.slice(0, 10);
  throw new Error("formation_date_missing");
}

router.post("/applications/:id/score", requireAuth, async (req, res) => {
  const { id } = req.params;
  const r = await pool.query(`SELECT * FROM bi_applications WHERE id = $1`, [id]);
  const app = r.rows[0];
  if (!app) return res.status(404).json({ error: "not_found" });

  let formationDateIso: string;
  try {
    formationDateIso = formationDateIsoOrThrow(app.formation_date);
  } catch {
    return res.status(400).json({ error: "formation_date_missing" });
  }

  try {
    const score = await pgiScore({
      country: app.country, naics_code: app.naics_code,
      formation_date: formationDateIso,
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

  // BI_SERVER_BLOCK_v349_PURBECK_SUBMIT_GATE_v1
  const docCheck = await pool.query(
    `SELECT 1 FROM bi_documents
       WHERE application_id = $1
         AND doc_type IN ('loan_agreement', 'loan_agreement_signed')
       LIMIT 1`,
    [id],
  );
  if (!docCheck.rows.length) {
    return res.status(412).json({
      error: "loan_agreement_required",
      message: "Cannot submit to Purbeck without a loan_agreement document on file.",
    });
  }

  // BI_SERVER_BLOCK_v349_V2_PAYLOAD_v1
  const { buildCarrierPayloadV2 } = await import("../services/pgiCarrierMapper");
  const { validatePgiSubmissionV2 } = await import("../lib/validation/pgiFields");
  const { pgiSubmitV2, PgiCarrierValidationError } = await import("../services/pgiAdapter");

  const payload = buildCarrierPayloadV2(
    app as Record<string, unknown>,
    (app.data ?? {}) as Record<string, unknown>,
    (app.declarations ?? {}) as Record<string, unknown>,
  );

  const valid = validatePgiSubmissionV2(payload);
  if (!valid.ok) {
    const errors: Record<string, string> = {};
    for (const i of valid.issues) errors[i.field] = i.message;
    return res.status(400).json({ error: "validation_failed", errors });
  }

  try {
    const submit = await pgiSubmitV2(valid.value);
    await pool.query(
      `UPDATE bi_applications SET pgi_application_id=$1, status='submitted', updated_at=NOW() WHERE id=$2`,
      [submit.application_id, id],
    );

    if (app.has_co_guarantors === true) {
      const numbers = (process.env.MAYA_FALLBACK_SMS_NUMBERS || "")
        .split(",").map((n: string) => n.trim()).filter(Boolean);
      for (const to of numbers) {
        try {
          const { sendOutreachSms } = await import("../services/smsService");
          await sendOutreachSms(to, `BI app ${app.public_id || id} submitted to PGI WITH CO-GUARANTORS. Contact applicant to handle co-guarantor intake (not in partner API).`);
        } catch (e) {
          console.warn("[purbeck_submit] co-guarantor SMS failed (non-blocking):", (e as Error).message);
        }
      }
    }

    return res.json({ ok: true, pgi_application_id: submit.application_id, status: "submitted" });
  } catch (err: unknown) {
    if (err instanceof PgiCarrierValidationError) {
      return res.status(400).json({ error: "carrier_validation_failed", errors: err.errors });
    }
    await pool.query(
      `UPDATE bi_applications SET score_decision='error', score_reason=$1, score_at=NOW() WHERE id=$2`,
      [String((err as Error)?.message ?? "unknown"), id],
    );
    return res.status(502).json({ error: "pgi_submit_failed", detail: String((err as Error)?.message) });
  }
});

export default router;
