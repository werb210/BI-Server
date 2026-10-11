// BI_BLOCK_PGI_ALIGNMENT_v1 — score + submit-to-pgi handlers.
import { logHiddenError } from "../platform/safeError";
import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../platform/auth";
import { pgiScore } from "../services/pgiAdapter";
import { submitApplicationToPGI, assertDocsReadyForCarrier, flushAcceptedDocsAfterSubmit } from "../services/biPgiSubmissionService";
import { logger } from "../platform/logger";
import { maskPhone } from "../util/mask";

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
    await pool.query(`UPDATE bi_applications SET score_decision='error', score_reason=$1, score_at=NOW() WHERE id=$2`, ["pgi_score_failed", id])
      .catch((dbErr) => { logger.warn({ err: dbErr, applicationId: id }, "pgi_score_failure_mark_failed"); });
    return res.status(502).json({ error: "pgi_score_failed", requestId: logHiddenError(req, err, "pgi_score_failed") });
  }
});

// BI_SERVER_v789_SCORE_SUBMIT_GATES - this direct carrier submit had none of
// the controls the staff submit path (biApplicationRoutes submit-to-carrier)
// has: any authenticated user could fire it, it did not take the submission
// lock (two clicks = two carrier applications), counted rejected and deleted
// documents as "on file", and never forwarded the documents. Now:
//   - Admin only (403 otherwise)
//   - 409 when already submitted or the submission lock is held, and the
//     submit goes through submitApplicationToPGI's atomic claim
//   - only accepted, non-purged documents count, plus the same per-slot
//     readiness check (assertDocsReadyForCarrier) as the staff path
//   - accepted documents are forwarded after the submit
//   - responses carry codes, never carrier error text
router.post("/applications/:id/submit-to-pgi", requireAuth, async (req, res) => {
  const role = String((req.user as { role?: string } | undefined)?.role ?? "").toLowerCase();
  if (role !== "admin") return res.status(403).json({ error: "ADMIN_ONLY" });

  const { id } = req.params;
  const r = await pool.query(`SELECT * FROM bi_applications WHERE id=$1`, [id]);
  const app = r.rows[0];
  if (!app) return res.status(404).json({ error: "not_found" });
  if (app.pgi_application_id || app.pgi_external_id) {
    return res.status(409).json({ error: "already_submitted", pgi_application_id: app.pgi_application_id ?? app.pgi_external_id });
  }
  if (app.submission_locked === true) return res.status(409).json({ error: "ALREADY_LOCKED" });

  // BI_SERVER_BLOCK_v349_PURBECK_SUBMIT_GATE_v1
  const docCheck = await pool.query(
    `SELECT 1 FROM bi_documents
       WHERE application_id = $1
         AND doc_type IN ('loan_agreement', 'loan_agreement_signed')
         AND review_status = 'accepted'
         AND purged_at IS NULL
       LIMIT 1`,
    [id],
  );
  if (!docCheck.rows.length) {
    return res.status(412).json({
      error: "loan_agreement_required",
      message: "Cannot submit to Purbeck without an accepted loan_agreement document on file.",
    });
  }

  // BI_SERVER_BLOCK_v351_CARRIER_CORRECTIONS_v1 - startup doc gate.
  // If business is under 3 years old (per q26_formation_date), Purbeck requires
  // founder_cv + financial_forecast in addition to loan_agreement.
  const formationRaw = (app as any).formation_date || (app as any).q26_formation_date || (app as any).data?.formation_date;
  if (formationRaw) {
    const formationDate = new Date(formationRaw);
    if (!isNaN(formationDate.getTime())) {
      const ageMs = Date.now() - formationDate.getTime();
      const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
      const isStartup = ageYears < 3;
      if (isStartup) {
        const startupDocs = await pool.query(
          `SELECT DISTINCT doc_type FROM bi_documents
             WHERE application_id = $1
               AND doc_type IN ('founder_cv', 'financial_forecast')
               AND review_status = 'accepted'
               AND purged_at IS NULL`,
          [id],
        );
        const present = new Set(startupDocs.rows.map((r: { doc_type: string }) => r.doc_type));
        const missing: string[] = [];
        if (!present.has("founder_cv"))         missing.push("founder_cv");
        if (!present.has("financial_forecast")) missing.push("financial_forecast");
        if (missing.length > 0) {
          return res.status(412).json({
            error: "startup_docs_required",
            message: `Business is under 3 years old (formed ${formationDate.toISOString().slice(0, 10)}). Purbeck requires additional documents: ${missing.join(", ")}.`,
            missing_documents: missing,
            business_age_years: Number(ageYears.toFixed(2)),
          });
        }
      }
    }
  }

  // Same per-slot readiness gate as the staff submit path.
  let formationIso: string | null = null;
  try { formationIso = formationRaw ? formationDateIsoOrThrow(formationRaw) : null; } catch { formationIso = null; }
  const readiness = await assertDocsReadyForCarrier(id, formationIso);
  if (!readiness.ready) {
    return res.status(400).json({
      error: "DOCS_NOT_READY",
      missing: readiness.missing,
      rejected: readiness.rejected,
      pending: readiness.pending,
    });
  }

  // BI_SERVER_BLOCK_v349_V2_PAYLOAD_v1
  const { buildCarrierPayloadV2 } = await import("../services/pgiCarrierMapper");
  const { validatePgiSubmissionV2 } = await import("../lib/validation/pgiFields");
  const { PgiCarrierValidationError } = await import("../services/pgiAdapter");

  const payload = buildCarrierPayloadV2(
    app as Record<string, unknown>,
    (app.data ?? {}) as Record<string, unknown>,
    (app.declarations ?? {}) as Record<string, unknown>,
    {
      guarantor_name: app.guarantor_name as string | undefined,
      guarantor_email: app.guarantor_email as string | undefined,
      business_name: app.business_name as string | undefined,
      lender_name: null,
    },
  );

  const valid = validatePgiSubmissionV2(payload);
  if (!valid.ok) {
    const errors: Record<string, string> = {};
    for (const i of valid.issues) errors[i.field] = i.message;
    return res.status(400).json({ error: "validation_failed", errors });
  }

  try {
    const submit = await submitApplicationToPGI(id, { payload: valid.value as unknown as Record<string, unknown> });
    if (submit.alreadySubmitted) {
      return res.status(409).json({ error: submit.externalId ? "already_submitted" : "ALREADY_LOCKED", pgi_application_id: submit.externalId || null });
    }
    const docsForwarded = await flushAcceptedDocsAfterSubmit(id, submit.externalId);

    if (app.has_co_guarantors === true) {
      const numbers = (process.env.MAYA_FALLBACK_SMS_NUMBERS || "")
        .split(",").map((n: string) => n.trim()).filter(Boolean);
      for (const to of numbers) {
        try {
          const { sendOutreachSms } = await import("../services/smsService");
          await sendOutreachSms(to, `BI app ${app.public_id || id} submitted to PGI WITH CO-GUARANTORS. Contact applicant to handle co-guarantor intake (not in partner API).`);
        } catch (e) {
          logger.warn({ err: e, to: maskPhone(to), applicationId: id }, "[purbeck_submit] co-guarantor SMS failed (non-blocking)");
        }
      }
    }

    return res.json({ ok: true, pgi_application_id: submit.externalId, status: "submitted", docs_forwarded: docsForwarded });
  } catch (err: unknown) {
    // submitApplicationToPGI released the claim and wrote carrier_submission_failed.
    if (err instanceof PgiCarrierValidationError) {
      return res.status(400).json({ error: "carrier_validation_failed", fields: Object.keys(err.errors ?? {}), requestId: logHiddenError(req, err, "carrier_validation_failed") });
    }
    await pool.query(
      `UPDATE bi_applications SET score_decision='error', score_reason=$1, score_at=NOW() WHERE id=$2`,
      ["pgi_submit_failed", id],
    ).catch((dbErr) => { logger.warn({ err: dbErr, applicationId: id }, "pgi_submit_failure_mark_failed"); });
    return res.status(502).json({ error: "pgi_submit_failed", requestId: logHiddenError(req, err, "pgi_submit_failed") });
  }
});

export default router;
