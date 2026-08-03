-- BI_SENDGRID_WEBHOOK_SUPPRESSION_FIX_v3
-- bi_marketing_send_events is INSERTed into by the SendGrid Event Webhook and
-- is created by no migration anywhere in this repo. Every insert therefore
-- raised 42P01 (undefined_table) straight into a .catch(() => undefined), so
-- the per-event ledger the webhook promises has always been empty and nothing
-- ever said so.
--
-- job_id and contact_id are TEXT rather than UUID on purpose: they arrive from
-- SendGrid custom_args, i.e. from outside, and a malformed value must not turn
-- a ledger row into a failed insert that takes the batch with it.
CREATE TABLE IF NOT EXISTS bi_marketing_send_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     TEXT,
  contact_id TEXT,
  email      TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_marketing_send_events_email_lower
  ON bi_marketing_send_events (lower(email));
CREATE INDEX IF NOT EXISTS idx_bi_marketing_send_events_created
  ON bi_marketing_send_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bi_marketing_send_events_job
  ON bi_marketing_send_events (job_id);
