// BI_APPLICANT_ACTION_CENTER_v199
// The applicant's outstanding-work list for BI.
//
// Both halves of the answer already existed and were already correct - the
// catalog-driven document check inside pgiCompletion.ts, and outstandingQuestions
// in biApplicantSubmitRoutes.ts. Neither is re-implemented here. This unions them
// so the client has one call to make, and so a future change to either rule shows
// up on the applicant's home screen without a second edit.
import { pool } from "../db";

export type BiActionItem = {
  key: string;
  kind: "document" | "question";
  label: string;
  urgent: boolean;
};

export type BiActionCenter = {
  outstanding: BiActionItem[];
  completed: BiActionItem[];
  outstandingCount: number;
  canSubmit: boolean;
};

function pretty(raw: string): string {
  return String(raw ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "Document";
}

export async function buildBiActionCenter(applicationId: string): Promise<BiActionCenter> {
  // Same catalog rules pgiCompletion applies: active rows only, optional rows do
  // not gate, and a rejected upload does not count as satisfied.
  const docs = await pool.query<{ doc_type: string; display_label: string | null; satisfied: boolean; rejected: boolean }>(
    `SELECT c.doc_type,
            c.display_label,
            EXISTS (
              SELECT 1 FROM bi_documents d
               WHERE d.application_id::text = $1
                 AND d.doc_type = c.doc_type
                 AND d.purged_at IS NULL
                 AND COALESCE(d.review_status, 'pending') <> 'rejected'
            ) AS satisfied,
            EXISTS (
              SELECT 1 FROM bi_documents d
               WHERE d.application_id::text = $1
                 AND d.doc_type = c.doc_type
                 AND d.purged_at IS NULL
                 AND COALESCE(d.review_status, 'pending') = 'rejected'
            ) AS rejected
       FROM bi_required_doc_catalog c
      WHERE c.active = TRUE
        AND COALESCE(c.required, TRUE) = TRUE
      ORDER BY c.sort_order`,
    [applicationId],
  ).catch(() => ({ rows: [] as any[] }));

  const questions = await pool.query<{ question_key: string; prompt: string }>(
    `SELECT q.question_key, q.prompt
       FROM bi_application_products ap
       JOIN bi_products p ON p.id = ap.product_id
       JOIN bi_coverage_questions cq ON cq.coverage_code = p.code
       JOIN bi_questions q ON q.question_key = cq.question_key
       LEFT JOIN bi_application_answers a
         ON a.application_id = ap.application_id AND a.question_key = q.question_key
      WHERE ap.application_id::text = $1
        AND q.required = TRUE
        AND (a.value IS NULL OR a.value = ''
             OR (q.adverse_answer IS NOT NULL AND a.value = q.adverse_answer
                 AND COALESCE(TRIM(a.reason),'') = ''))
      GROUP BY q.question_key, q.prompt`,
    [applicationId],
  ).catch(() => ({ rows: [] as any[] }));

  const outstanding: BiActionItem[] = [];
  const completed: BiActionItem[] = [];

  for (const r of docs.rows ?? []) {
    const item: BiActionItem = {
      key: `upload:${r.doc_type}`,
      kind: "document",
      label: r.display_label || pretty(r.doc_type),
      urgent: Boolean(r.rejected),
    };
    // A rejected upload is outstanding even though a row exists for it.
    if (r.satisfied && !r.rejected) completed.push(item);
    else outstanding.push(item);
  }

  for (const r of questions.rows ?? []) {
    outstanding.push({
      key: `question:${r.question_key}`,
      kind: "question",
      label: r.prompt,
      urgent: false,
    });
  }

  outstanding.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.label.localeCompare(b.label));

  return {
    outstanding,
    completed,
    outstandingCount: outstanding.length,
    canSubmit: outstanding.length === 0,
  };
}
