CREATE TABLE IF NOT EXISTS bi_webhook_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pgi_webhook_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bi_webhook_log_event_type ON bi_webhook_log(event_type);
CREATE INDEX IF NOT EXISTS idx_bi_webhook_log_created_at ON bi_webhook_log(created_at);
