-- BI_SERVER_BLOCK_v242_PIPELINE_AND_REMINDERS_v1
-- Add two new pipeline stage values + four reminder-cadence columns.
-- The two new stages encode the BI-internal review states operator
-- specified (docs_rejected = staff kicked a doc back to the applicant;
-- sent_to_pgi = staff accepted all docs and forwarded to the carrier,
-- OR a lender bypassed staff review entirely).
-- The reminder columns drive the daily SMS cron that pesters applicants
-- who submitted with no docs uploaded. docs_due_at marks when reminders
-- should start; docs_reminder_count counts how many sent so far;
-- docs_reminder_last_sent_at gates the 24-hour cadence; and
-- docs_reminder_escalated flips TRUE after the 10th send when we
-- text the BI staff escalation number instead of the applicant.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname='bi_pipeline_stage') THEN
    ALTER TYPE bi_pipeline_stage ADD VALUE IF NOT EXISTS 'docs_rejected';
    ALTER TYPE bi_pipeline_stage ADD VALUE IF NOT EXISTS 'sent_to_pgi';
  END IF;
END$$;

ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS docs_due_at                 TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS docs_reminder_last_sent_at  TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS docs_reminder_count         INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS docs_reminder_escalated     BOOLEAN   NOT NULL DEFAULT FALSE;

-- Cron job uses this to find apps needing a reminder send.
CREATE INDEX IF NOT EXISTS idx_bi_apps_reminder_due
  ON bi_applications (docs_due_at, docs_reminder_last_sent_at)
  WHERE docs_reminder_escalated = FALSE;
