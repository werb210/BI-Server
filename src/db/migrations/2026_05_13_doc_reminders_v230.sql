-- BI_SERVER_BLOCK_v230_DEFER_DOCS_AND_SMS_REMINDERS_v1
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS docs_deferred_at      TIMESTAMPTZ;
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS doc_reminder_count    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS last_doc_reminder_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bi_applications_pending_docs
  ON bi_applications(status, created_at)
  WHERE status IN ('in_progress', 'document_review');
