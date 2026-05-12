-- BI_SERVER_BLOCK_v225_CARRIER_VISIBILITY_v1
-- Adds the carrier-feedback tracking columns. All idempotent.

ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS carrier_received_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS carrier_last_event          TEXT,
  ADD COLUMN IF NOT EXISTS carrier_last_event_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS carrier_submission_request  JSONB,
  ADD COLUMN IF NOT EXISTS carrier_submission_response JSONB,
  ADD COLUMN IF NOT EXISTS carrier_submission_error    TEXT;

CREATE INDEX IF NOT EXISTS idx_bi_applications_carrier_last_event_at
  ON bi_applications(carrier_last_event_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_bi_applications_carrier_received_at
  ON bi_applications(carrier_received_at DESC NULLS LAST);
