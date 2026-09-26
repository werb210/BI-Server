-- BI_SERVER_BLOCK_v568_BI_VISITOR_JOURNEY - page-by-page journey on boreal.insure.
CREATE TABLE IF NOT EXISTS bi_visitor_sessions (
  session_id TEXT PRIMARY KEY,
  public_id TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  landing_page TEXT, referrer TEXT, gclid TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_bi_visitor_sessions_public_id ON bi_visitor_sessions (public_id);
CREATE TABLE IF NOT EXISTS bi_visitor_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  path TEXT, title TEXT, step TEXT, dwell_ms INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_visitor_events_session ON bi_visitor_events (session_id, occurred_at);
