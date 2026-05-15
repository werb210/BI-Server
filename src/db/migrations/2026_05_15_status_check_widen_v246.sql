-- BI_SERVER_BLOCK_v246_STATUS_CHECK_v1
-- v242 + v243 added new status values that biLenderApplicationCreate
-- writes ('sent_to_pgi') and v242's pipeline mapping references
-- ('docs_rejected'). The v330 CHECK constraint enumerates the OLD set
-- only; every lender submission that completes pgiSubmit and tries to
-- UPDATE status='sent_to_pgi' fails with:
--   error: new row for relation "bi_applications" violates check
--   constraint "bi_applications_status_check"
-- And v243's data-migration UPDATE of legacy 'submitted' rows to
-- 'sent_to_pgi' also fails for the same reason -- silently rolled back
-- as "migration failed (non-blocking)".
--
-- Net effect in production: every lender submission writes the row
-- once (status='new_application' via INSERT), pgiSubmit succeeds,
-- then the post-success UPDATE silently fails. Rows are stuck at
-- new_application forever. Demo apps appear in real pipeline (was
-- the v244 bug -- fixed there), and real submissions never advance
-- past stage 1.
--
-- This migration extends the CHECK to include the three values v242
-- and v243 introduced: sent_to_pgi, docs_rejected, accepted.
-- Idempotent: DROP IF EXISTS guards the change.

BEGIN;

ALTER TABLE bi_applications
  DROP CONSTRAINT IF EXISTS bi_applications_status_check;

ALTER TABLE bi_applications
  ADD CONSTRAINT bi_applications_status_check
  CHECK (status IN (
    'new_application',
    'created',
    'in_progress',
    'document_review',
    'ready_for_submission',
    'submitted',
    'under_review',
    'information_required',
    'docs_rejected',
    'sent_to_pgi',
    'approved',
    'accepted',
    'declined',
    'policy_issued'
  ));

COMMIT;
