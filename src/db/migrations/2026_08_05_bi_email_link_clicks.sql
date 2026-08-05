-- BI_SERVER_EMAIL_LINK_CLICKS_v11
-- Parity with BF_SERVER_EMAIL_LINK_CLICKS_v19. The BI webhook logged
-- sg_event_id/reason/type into bi_marketing_send_events.detail and dropped
-- ev.url, so a click event could never say which link was clicked.
-- job_id/contact_id stay TEXT for the same reason as the events ledger: the
-- values arrive from SendGrid custom_args and a malformed one must not fail
-- the insert.
CREATE TABLE IF NOT EXISTS bi_email_link_clicks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     TEXT,
  contact_id TEXT,
  email      TEXT NOT NULL,
  url        TEXT NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_elc_url ON bi_email_link_clicks (url, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_bi_elc_job ON bi_email_link_clicks (job_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_bi_elc_email ON bi_email_link_clicks (lower(email));
