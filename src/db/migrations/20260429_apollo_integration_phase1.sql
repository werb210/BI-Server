-- BI_APOLLO_INTEGRATION_v54_PHASE1 — Apollo.io contact + engagement schema.
-- Idempotent. All adds use IF NOT EXISTS / IF NOT NULL guards.

-- 1) Extend bi_contacts with Apollo identity + cached enrichment payload.
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS apollo_contact_id     TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS apollo_last_synced_at TIMESTAMP;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS apollo_data           JSONB;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS apollo_stage          TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS apollo_sequence_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_contacts_apollo_id
  ON bi_contacts(apollo_contact_id)
  WHERE apollo_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bi_contacts_apollo_synced
  ON bi_contacts(apollo_last_synced_at);

-- 2) Engagement event log. One row per Apollo email event we observe.
CREATE TABLE IF NOT EXISTS bi_crm_engagement_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID REFERENCES bi_contacts(id) ON DELETE CASCADE,
  apollo_contact_id TEXT,
  event_type      TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'apollo',
  apollo_message_id TEXT,
  sequence_name   TEXT,
  occurred_at     TIMESTAMP NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_engagement_dedupe
  ON bi_crm_engagement_events(apollo_message_id, event_type)
  WHERE apollo_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bi_engagement_contact
  ON bi_crm_engagement_events(contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_bi_engagement_apollo_contact
  ON bi_crm_engagement_events(apollo_contact_id, occurred_at DESC);

-- 3) Sync state — one row, tracks watermark for incremental polls.
CREATE TABLE IF NOT EXISTS bi_apollo_sync_state (
  id                INT PRIMARY KEY DEFAULT 1,
  last_contact_sync_at      TIMESTAMP,
  last_engagement_sync_at   TIMESTAMP,
  last_run_status   TEXT,
  last_run_message  TEXT,
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT bi_apollo_sync_state_singleton CHECK (id = 1)
);

INSERT INTO bi_apollo_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
