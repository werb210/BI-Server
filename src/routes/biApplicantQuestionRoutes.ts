// BI_QUESTION_BANK_v24 - serve the deduplicated union of selected coverage questions.
import { Router } from "express";
import { pool } from "../db";
import { authApplicant, type ApplicantReq } from "./applicantAuth";

const router = Router();
const COUNTRIES = new Set(["CA", "US"]);

function normCountry(raw: unknown): "CA" | "US" {
  const value = String(raw ?? "").trim().toUpperCase();
  return COUNTRIES.has(value) ? (value as "CA" | "US") : "CA";
}

async function ownedApplication(publicIdOrId: string, phone: string) {
  if (publicIdOrId === "me") {
    const mine = await pool.query(
      `SELECT id, public_id, country, applicant_phone_e164, guarantor_phone
         FROM bi_applications
        WHERE (applicant_phone_e164 = $1 OR guarantor_phone = $1)
          AND status IN ('created','in_progress')
        ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    if (!mine.rows[0]) return { app: null as any, error: "not_found" as const };
    return { app: mine.rows[0], error: null };
  }
  const result = await pool.query(
    `SELECT id, public_id, country, applicant_phone_e164, guarantor_phone
       FROM bi_applications WHERE public_id = $1 OR id::text = $1 LIMIT 1`,
    [publicIdOrId],
  );
  const app = result.rows[0];
  if (!app) return { app: null as any, error: "not_found" as const };
  const owners = [app.applicant_phone_e164, app.guarantor_phone].filter(Boolean);
  if (!owners.includes(phone)) return { app: null as any, error: "not_owner" as const };
  return { app, error: null };
}

type QRow = {
  question_key: string; prompt: string; help_text: string | null;
  input_type: string; group_key: string; adverse_answer: string | null;
  required: boolean; depends_on_key: string | null; depends_on_value: string | null;
  sort_order: number; asked_by: string[]; value: string | null; reason: string | null;
};

async function questionsFor(applicationId: string, country: "CA" | "US") {
  const result = await pool.query<QRow>(
    `SELECT q.question_key, q.prompt, q.help_text, q.input_type, q.group_key,
            q.adverse_answer, q.required, q.depends_on_key, q.depends_on_value,
            MIN(cq.sort_order) AS sort_order,
            ARRAY_AGG(DISTINCT p.display_name) AS asked_by,
            MAX(a.value) AS value, MAX(a.reason) AS reason
       FROM bi_application_products ap
       JOIN bi_products p ON p.id = ap.product_id
       JOIN bi_coverage_questions cq ON cq.coverage_code = p.code AND cq.country = $2
       JOIN bi_questions q ON q.question_key = cq.question_key
       LEFT JOIN bi_application_answers a
         ON a.application_id = ap.application_id AND a.question_key = q.question_key
      WHERE ap.application_id = $1
      GROUP BY q.question_key, q.prompt, q.help_text, q.input_type, q.group_key,
               q.adverse_answer, q.required, q.depends_on_key, q.depends_on_value
      ORDER BY MIN(cq.sort_order) ASC, q.question_key ASC`,
    [applicationId, country],
  );
  return result.rows.map((row) => ({
    questionKey: row.question_key, prompt: row.prompt, helpText: row.help_text,
    inputType: row.input_type, group: row.group_key, adverseAnswer: row.adverse_answer,
    required: row.required, dependsOnKey: row.depends_on_key,
    dependsOnValue: row.depends_on_value, sortOrder: Number(row.sort_order),
    askedBy: row.asked_by ?? [], value: row.value, reason: row.reason,
  }));
}

router.get("/applicants/applications/:id/questions", authApplicant, async (req: ApplicantReq, res) => {
  const { app, error } = await ownedApplication(req.params.id, String(req.applicantPhone));
  if (error) return res.status(error === "not_found" ? 404 : 403).json({ error });
  const country = normCountry(app.country);
  res.json({ applicationId: app.public_id, country, questions: await questionsFor(app.id, country) });
});

router.post("/applicants/applications/:id/answers", authApplicant, async (req: ApplicantReq, res) => {
  const { app, error } = await ownedApplication(req.params.id, String(req.applicantPhone));
  if (error) return res.status(error === "not_found" ? 404 : 403).json({ error });
  const raw = Array.isArray(req.body?.answers) ? req.body.answers : [];
  if (raw.length === 0) return res.status(400).json({ error: "no_answers" });
  if (raw.length > 200) return res.status(400).json({ error: "too_many_answers" });
  const answers = raw.map((answer: any) => ({
    key: String(answer?.questionKey ?? "").trim(),
    value: answer?.value == null ? null : String(answer.value).slice(0, 400),
    reason: answer?.reason == null ? null : String(answer.reason).slice(0, 4000),
  })).filter((answer: { key: string }) => answer.key.length > 0);
  if (answers.length === 0) return res.status(400).json({ error: "no_answers" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const answer of answers) {
      await client.query(
        `INSERT INTO bi_application_answers (application_id, question_key, value, reason, answered_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (application_id, question_key)
         DO UPDATE SET value = EXCLUDED.value, reason = EXCLUDED.reason, answered_at = NOW()`,
        [app.id, answer.key, answer.value, answer.reason],
      );
    }
    await client.query("COMMIT");
  } catch (error: any) {
    await client.query("ROLLBACK");
    if (error?.code === "23503") return res.status(400).json({ error: "unknown_question_key" });
    throw error;
  } finally {
    client.release();
  }

  const country = normCountry(app.country);
  const questions = await questionsFor(app.id, country);
  const outstanding = questions.filter((question) => question.required && !question.value).length;
  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
     VALUES($1,'applicant','questions_answered',$2)`,
    [app.id, `${answers.length} answer(s) saved, ${outstanding} required question(s) outstanding`],
  ).catch(() => {});
  res.json({ applicationId: app.public_id, country, outstanding, questions });
});

export default router;
