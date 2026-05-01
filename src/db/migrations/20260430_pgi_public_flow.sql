-- BI_AUDIT_FIX_v58 — public application sign + lock state.
-- Idempotent.
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS signed_at         TIMESTAMP;
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS signature_data    JSONB;
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS submission_locked BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_bi_applications_signed_at ON bi_applications(signed_at);
CREATE INDEX IF NOT EXISTS idx_bi_applications_locked    ON bi_applications(submission_locked);
