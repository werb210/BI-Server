-- BI_SERVER_BLOCK_62_MIGRATION_UNBLOCK_v1
-- Filename intentionally sorts AFTER 2026_05_15_b...(v330) and BEFORE
-- 2026_05_15z_...(v243) so this runs in between them on the next boot:
--   _b... (0x5F+0x62) < a_... (0x61) < z_... (0x7A) in ASCII order.
--
-- v330 widened the status check to allow new_application/created/.../policy_issued
-- but missed 'sent_to_pgi'. v243 UPDATEs lender rows to status='sent_to_pgi'
-- and fails the check, which makes runMigrations.ts throw (code 23514 is not
-- in the ALREADY_APPLIED safe set), halting the entire migration run. Every
-- migration ordered after z243 has been skipped on every cold start since
-- z243 was added. Production log shows the throw + "BI database
-- initialization failed (non-blocking)" + downstream errors:
--   - relation "bi_sequence_enrollments" does not exist (every 60s)
--   - relation "bi_mailbox_health" does not exist
--
-- Idempotent.

ALTER TABLE bi_applications DROP CONSTRAINT IF EXISTS bi_applications_status_check;
ALTER TABLE bi_applications ADD CONSTRAINT bi_applications_status_check
  CHECK (status IN (
    'new_application',
    'created',
    'in_progress',
    'document_review',
    'ready_for_submission',
    'submitted',
    'sent_to_pgi',
    'under_review',
    'information_required',
    'approved',
    'declined',
    'policy_issued'
  ));
