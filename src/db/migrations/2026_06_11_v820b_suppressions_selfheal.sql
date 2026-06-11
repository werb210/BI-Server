-- BI_SERVER_BLOCK_v820b_CRM_DELETE_SUPPRESSION
-- Force bi_suppressions to a known-good superset shape, idempotently, so
-- CRM-delete suppression works regardless of the live table's recovered shape.
ALTER TABLE bi_suppressions ADD COLUMN IF NOT EXISTS identifier TEXT;
ALTER TABLE bi_suppressions ADD COLUMN IF NOT EXISTS contact_id UUID;
ALTER TABLE bi_suppressions ADD COLUMN IF NOT EXISTS phone_e164 TEXT;
ALTER TABLE bi_suppressions ADD COLUMN IF NOT EXISTS email      TEXT;
ALTER TABLE bi_suppressions ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE bi_suppressions ADD COLUMN IF NOT EXISTS channel    TEXT;
ALTER TABLE bi_suppressions ADD COLUMN IF NOT EXISTS reason     TEXT;
ALTER TABLE bi_suppressions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- identifier may have been created NOT NULL; our inserts don't set it -> drop the constraint.
ALTER TABLE bi_suppressions ALTER COLUMN identifier DROP NOT NULL;
-- widen channel CHECK to include 'company' (and keep all prior values).
ALTER TABLE bi_suppressions DROP CONSTRAINT IF EXISTS bi_suppressions_channel_check;
ALTER TABLE bi_suppressions
  ADD CONSTRAINT bi_suppressions_channel_check
  CHECK (channel IN ('email','sms','all','call','company')) NOT VALID;
-- reason CHECK frequently excludes deleted_from_crm -> drop it entirely (free-text reason).
ALTER TABLE bi_suppressions DROP CONSTRAINT IF EXISTS bi_suppressions_reason_check;
-- indexes to make suppression checks fast and dedupe-friendly.
CREATE INDEX IF NOT EXISTS idx_bi_suppressions_email_lower ON bi_suppressions (lower(email));
CREATE INDEX IF NOT EXISTS idx_bi_suppressions_legal_name_lower ON bi_suppressions (lower(legal_name));
