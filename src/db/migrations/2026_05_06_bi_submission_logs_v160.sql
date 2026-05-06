-- BI_SERVER_BLOCK_v160_SUBMIT_TO_CARRIER_HARDENING_v1
-- bi_submission_logs: every PGI submission attempt — success, failure, retry.
-- Per V1 spec §4 (Audit trail) + §5 (Data model). Idempotent.

CREATE TABLE IF NOT EXISTS bi_submission_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL,
  payload_snapshot JSONB NOT NULL,
  submitted_by UUID,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_status INT,
  response_body JSONB,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS bi_submission_logs_application_idx
  ON bi_submission_logs(application_id);

CREATE INDEX IF NOT EXISTS bi_submission_logs_submitted_at_idx
  ON bi_submission_logs(submitted_at DESC);
