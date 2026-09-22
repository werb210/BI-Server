// BI_SERVER_NO_EMPTY_EMAIL_STEPS_v398
// test2's three email steps were stored with no subject, no body and no
// template, so every send failed with empty_email_step while the portal showed
// the sequence as ready. A sequence with an email step that has nothing to send
// can no longer be started or have contacts added, and the reason is shown.
import { pool } from "../db";

/** 1-based step numbers of email steps with no subject or no message (own or from their template). */
export async function emptyEmailSteps(sequenceId: string): Promise<number[]> {
  const r = await pool.query<{ position: number }>(
    `SELECT st.position
       FROM bi_sequence_steps st
       LEFT JOIN bi_email_templates t ON t.id::text = st.conditions->>'template_id'
      WHERE st.sequence_id = $1
        AND st.type = 'email'
        AND (
          NULLIF(btrim(COALESCE(NULLIF(btrim(st.subject), ''), t.subject, '')), '') IS NULL
          OR NULLIF(btrim(COALESCE(NULLIF(btrim(st.body), ''), NULLIF(t.body_html, ''), t.body_text, '')), '') IS NULL
        )
      ORDER BY st.position`,
    [sequenceId],
  );
  const all = await pool.query<{ position: number }>(
    `SELECT position FROM bi_sequence_steps WHERE sequence_id = $1 ORDER BY position`,
    [sequenceId],
  );
  const order = all.rows.map((row) => Number(row.position));
  return r.rows.map((row) => order.indexOf(Number(row.position)) + 1).filter((n) => n > 0);
}

export function emptyStepsMessage(steps: number[]): string {
  const list = steps.length === 1 ? `Step ${steps[0]}` : `Steps ${steps.join(", ")}`;
  return `${list} ${steps.length === 1 ? "is an email with" : "are emails with"} no subject or message. Open the sequence and pick an email template for ${steps.length === 1 ? "it" : "each"}.`;
}
