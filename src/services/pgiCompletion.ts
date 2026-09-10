// BI_PGI_COMPLETION_ON_ARRIVAL_v1
// One place that answers "is this PGI file complete, and what happens next".
//
// Lender-sourced applications are submitted to the carrier inline at creation
// (biApplicationRoutes POST /applications/lender). They never reach here in a
// pending state, and this function will not submit them.
//
// Public-sourced applications - which includes every PGI add-on created from
// BF Step 6, because /applications/from-bf inserts source_type 'public' - must
// be reviewed by staff before anything goes to the carrier.
import { pool } from "../db";
import { logger } from "../platform/logger";

export type CompletionResult =
  | { complete: false; outstanding: string[] }
  | { complete: true; advancedTo: string | null; reason: string };

export async function evaluatePgiCompletion(applicationId: string): Promise<CompletionResult> {
  const appRow = (
    await pool.query<{ source_type: string; status: string | null }>(
      `SELECT source_type, status FROM bi_applications WHERE id::text = $1 LIMIT 1`,
      [applicationId],
    )
  ).rows[0];
  if (!appRow) return { complete: false, outstanding: [] };

  // The catalog is the authority on what PGI requires. Startup-only rows are
  // excluded the same way the rest of the app treats them.
  const outstanding = (
    await pool.query<{ doc_type: string }>(
      `SELECT c.doc_type
         FROM bi_required_doc_catalog c
        WHERE c.active = TRUE
          -- BI_PGI_REQUIRED_FLAG_v1 - optional catalog rows do not gate completion.
          AND COALESCE(c.required, TRUE) = TRUE
          AND NOT EXISTS (
            SELECT 1 FROM bi_documents d
             WHERE d.application_id::text = $1
               AND d.doc_type = c.doc_type
               AND COALESCE(d.review_status, 'pending') <> 'rejected'
          )
        ORDER BY c.sort_order`,
      [applicationId],
    )
  ).rows.map((r) => r.doc_type);

  if (outstanding.length > 0) return { complete: false, outstanding };

  if (appRow.source_type !== "public") {
    // Lender files went to the carrier at submit time. Do not send twice.
    return { complete: true, advancedTo: null, reason: "lender_submitted_at_creation" };
  }

  await pool.query(
    `UPDATE bi_applications
        SET status = 'document_review', updated_at = NOW()
      WHERE id::text = $1
        AND COALESCE(status, '') <> 'document_review'`,
    [applicationId],
  );
  logger.info({ applicationId }, "bi.pgi.ready_for_staff_review");
  return { complete: true, advancedTo: "document_review", reason: "public_requires_staff_review" };
}
