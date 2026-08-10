// BI_CLIENT_SUBMIT_v25 - step 4. Until now nothing moved an application past
// in_progress, and finishing the questions dropped the applicant on the
// contract-requirements page, which is meaningless to anyone who never
// uploaded a contract. This is the review-and-submit end of the flow.
import { Router } from "express";
import { pool } from "../db";
import { authApplicant, type ApplicantReq } from "./applicantAuth";

const router = Router();

const COUNTRIES = new Set(["CA", "US"]);
function normCountry(raw: unknown): "CA" | "US" {
  const v = String(raw ?? "").trim().toUpperCase();
  return COUNTRIES.has(v) ? (v as "CA" | "US") : "CA";
}

async function ownedApplication(publicIdOrId: string, phone: string) {
  if (publicIdOrId === "me") {
    const mine = await pool.query(
      `SELECT id, public_id, country, status, data, applicant_phone_e164, guarantor_phone
         FROM bi_applications
        WHERE (applicant_phone_e164 = $1 OR guarantor_phone = $1)
          AND status IN ('created','in_progress','ready_for_submission')
        ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    if (!mine.rows[0]) return { app: null as any, error: "not_found" as const };
    return { app: mine.rows[0], error: null };
  }
  const r = await pool.query(
    `SELECT id, public_id, country, status, data, applicant_phone_e164, guarantor_phone
       FROM bi_applications WHERE public_id = $1 OR id::text = $1 LIMIT 1`,
    [publicIdOrId],
  );
  const app = r.rows[0];
  if (!app) return { app: null as any, error: "not_found" as const };
  const owners = [app.applicant_phone_e164, app.guarantor_phone].filter(Boolean);
  if (!owners.includes(phone)) return { app: null as any, error: "not_owner" as const };
  return { app, error: null };
}

// The same union step 3 uses, reduced to what is still unanswered. Submission
// is gated on this rather than on a client-side count, so a stale tab cannot
// submit an incomplete application.
async function outstandingQuestions(applicationId: string, country: "CA" | "US") {
  const r = await pool.query<{ question_key: string; prompt: string }>(
    `SELECT q.question_key, q.prompt
       FROM bi_application_products ap
       JOIN bi_products p ON p.id = ap.product_id
       JOIN bi_coverage_questions cq ON cq.coverage_code = p.code AND cq.country = $2
       JOIN bi_questions q ON q.question_key = cq.question_key
       LEFT JOIN bi_application_answers a
         ON a.application_id = ap.application_id AND a.question_key = q.question_key
      WHERE ap.application_id = $1
        AND q.required = TRUE
        AND (a.value IS NULL OR a.value = ''
             OR (q.adverse_answer IS NOT NULL AND a.value = q.adverse_answer
                 AND COALESCE(TRIM(a.reason),'') = ''))
      GROUP BY q.question_key, q.prompt`,
    [applicationId, country],
  );
  return r.rows.map((x) => ({ questionKey: x.question_key, prompt: x.prompt }));
}

async function summaryFor(app: any) {
  const country = normCountry(app.country);
  const [coverages, docs, answered, outstanding, referrals] = await Promise.all([
    pool.query(
      `SELECT p.code, p.display_name, ap.source
         FROM bi_application_products ap JOIN bi_products p ON p.id = ap.product_id
        WHERE ap.application_id = $1
        ORDER BY p.sort_order ASC, p.display_name ASC`,
      [app.id],
    ),
    pool.query(
      `SELECT original_filename, doc_type FROM bi_documents
        WHERE application_id = $1 AND purged_at IS NULL ORDER BY id ASC`,
      [app.id],
    ),
    pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM bi_application_answers
        WHERE application_id = $1 AND value IS NOT NULL AND value <> ''`,
      [app.id],
    ),
    outstandingQuestions(app.id, country),
    pool.query(
      `SELECT g.coverage_code, COALESCE(l.display_name, g.coverage_code) AS display_name,
              g.requested_limit, g.status
         FROM bi_coverage_gaps g
         LEFT JOIN bi_coverage_labels l ON l.coverage_code = g.coverage_code
        WHERE g.application_id = $1
        ORDER BY g.coverage_code ASC`,
      [app.id],
    ),
  ]);
  const d = app.data || {};
  return {
    applicationId: app.public_id,
    status: app.status,
    country,
    businessName: d.businessName ?? null,
    applicantName: d.applicantName ?? null,
    email: d.email ?? null,
    coverages: coverages.rows,
    documents: docs.rows,
    answered: Number(answered.rows[0]?.n ?? 0),
    outstanding,
    referrals: referrals.rows,
    canSubmit: (coverages.rows.length > 0 || referrals.rows.length > 0) && outstanding.length === 0,
  };
}

router.get("/applicants/applications/:id/summary", authApplicant, async (req: ApplicantReq, res) => {
  const { app, error } = await ownedApplication(req.params.id, String(req.applicantPhone));
  if (error) return res.status(error === "not_found" ? 404 : 403).json({ error });
  res.json(await summaryFor(app));
});

router.post("/applicants/applications/:id/submit", authApplicant, async (req: ApplicantReq, res) => {
  const { app, error } = await ownedApplication(req.params.id, String(req.applicantPhone));
  if (error) return res.status(error === "not_found" ? 404 : 403).json({ error });

  const summary = await summaryFor(app);
  if (summary.coverages.length === 0 && summary.referrals.length === 0) {
    return res.status(400).json({ error: "no_coverage_selected", ...summary });
  }
  if (summary.outstanding.length > 0) {
    return res.status(400).json({ error: "questions_outstanding", ...summary });
  }

  // ready_for_submission, not submitted: staff review the public application
  // before anything reaches a carrier. 'submitted' is set by the carrier
  // handoff, and claiming it here would put the application in a state the
  // pipeline reads as already sent.
  const upd = await pool.query(
    `UPDATE bi_applications
        SET status = 'ready_for_submission', updated_at = NOW()
      WHERE id = $1 AND status IN ('created','in_progress')
      RETURNING status`,
    [app.id],
  );
  const already = upd.rowCount === 0;

  if (!already) {
    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
       VALUES($1,'applicant','application_submitted',$2)`,
      [app.id, `Applicant submitted ${summary.coverages.length} coverage line(s) and ${summary.referrals.length} referral(s) for review`],
    ).catch(() => {});
  }

  res.json({ ...(await summaryFor(app)), alreadySubmitted: already });
});

export default router;
