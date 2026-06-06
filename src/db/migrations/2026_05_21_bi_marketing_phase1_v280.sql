-- BI_SERVER_BLOCK_BI_ROUND8_MARKETING_v1
-- Marketing module Phase 1 schema.
--
-- Tables:
--   bi_sequences            - campaign definitions
--   bi_sequence_steps       - ordered steps within a sequence
--   bi_sequence_lists       - saved segment filters
--   bi_sequence_enrollments - contact at step N of sequence X
--   bi_sequence_events      - per-step event log
--   bi_suppressions         - do-not-contact list
--   bi_mailbox_health       - rolling deliverability metrics
--
-- Idempotent. Re-running this migration adds nothing if the tables
-- already exist.

BEGIN;

-- Sequences: a named multi-step campaign.
CREATE TABLE IF NOT EXISTS bi_sequences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','active','paused','archived')),
  send_rate_cap   INT  NOT NULL DEFAULT 100,
  -- send-time scheduling: only send during these hours in recipient TZ
  send_hours_local_start INT NOT NULL DEFAULT 9   CHECK (send_hours_local_start BETWEEN 0 AND 23),
  send_hours_local_end   INT NOT NULL DEFAULT 17  CHECK (send_hours_local_end   BETWEEN 1 AND 24),
  send_weekdays_only BOOLEAN NOT NULL DEFAULT TRUE,
  -- A/B testing: when true, enrollments are split across variants
  ab_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  -- sender rotation: list of mailbox identifiers to round-robin across
  sender_rotation TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- auto-pause behavior
  pause_on_reply  BOOLEAN NOT NULL DEFAULT TRUE,
  pause_on_bounce BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMP
);
ALTER TABLE bi_sequences ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_bi_sequences_status ON bi_sequences(status) WHERE deleted_at IS NULL;

-- Steps within a sequence. Step ordering is by position (0-based).
-- delay_seconds is relative to the prior step's send time (or to
-- enrollment time for step 0).
CREATE TABLE IF NOT EXISTS bi_sequence_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id     UUID NOT NULL REFERENCES bi_sequences(id) ON DELETE CASCADE,
  position        INT  NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('sms','email','task','wait')),
  delay_seconds   INT  NOT NULL DEFAULT 0,
  subject         TEXT,                 -- email only
  body            TEXT,                 -- sms/email body or task description
  -- A/B variant key. Steps with the same (sequence_id, position) but
  -- different variant get split across enrollments when sequences.ab_enabled.
  variant         TEXT NOT NULL DEFAULT 'A',
  -- Skip conditions: JSON. Examples:
  --   {"skip_if": {"replied": true}}
  --   {"skip_if": {"on_suppression_list": true}}
  conditions      JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE bi_sequence_steps ADD COLUMN IF NOT EXISTS sequence_id UUID;
ALTER TABLE bi_sequence_steps ADD COLUMN IF NOT EXISTS position INT;
ALTER TABLE bi_sequence_steps ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'A';
CREATE INDEX IF NOT EXISTS idx_bi_sequence_steps_seq ON bi_sequence_steps(sequence_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_sequence_steps_pos_variant ON bi_sequence_steps(sequence_id, position, variant);

-- Lists / segments: saved filter against bi_contacts.
CREATE TABLE IF NOT EXISTS bi_sequence_lists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  -- JSON filter spec. Worker + endpoint translate to SQL WHERE clause:
  --   {"naics_prefix": ["31","32","33"],
  --    "country": ["CA"],
  --    "tags_any": ["warm_lead"],
  --    "min_revenue": 500000}
  filter_spec     JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by      UUID,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMP
);

-- Enrollments: one row per contact per sequence membership.
CREATE TABLE IF NOT EXISTS bi_sequence_enrollments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id     UUID NOT NULL REFERENCES bi_sequences(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES bi_contacts(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','paused','completed','stopped')),
  current_step    INT  NOT NULL DEFAULT 0,
  variant         TEXT NOT NULL DEFAULT 'A',
  paused_reason   TEXT,                                -- 'replied' | 'bounced' | 'unsubscribed' | 'manual'
  next_step_at    TIMESTAMP,                           -- when the worker should process next
  started_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  last_step_at    TIMESTAMP,
  completed_at    TIMESTAMP
);
ALTER TABLE bi_sequence_enrollments ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'A';
ALTER TABLE bi_sequence_enrollments ADD COLUMN IF NOT EXISTS paused_reason TEXT;
ALTER TABLE bi_sequence_enrollments ADD COLUMN IF NOT EXISTS next_step_at TIMESTAMP;
ALTER TABLE bi_sequence_enrollments ADD COLUMN IF NOT EXISTS started_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE bi_sequence_enrollments ADD COLUMN IF NOT EXISTS last_step_at TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_enrollment_seq_contact ON bi_sequence_enrollments(sequence_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_bi_enrollment_next ON bi_sequence_enrollments(next_step_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bi_enrollment_contact ON bi_sequence_enrollments(contact_id, status);

-- Events: every send/reply/click/bounce. Worker writes here.
CREATE TABLE IF NOT EXISTS bi_sequence_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id   UUID NOT NULL REFERENCES bi_sequence_enrollments(id) ON DELETE CASCADE,
  step_id         UUID REFERENCES bi_sequence_steps(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN ('sent','delivered','opened','clicked','replied','bounced','stopped','failed','suppressed','skipped')),
  channel         TEXT,                                -- 'sms' | 'email' | NULL for non-comms events
  sender_id       TEXT,                                -- mailbox or phone number rotated to
  metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_events_enrollment ON bi_sequence_events(enrollment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bi_events_type_time ON bi_sequence_events(event_type, created_at DESC);

-- Suppressions: do-not-contact. Either a contact reference OR a raw
-- phone/email so external suppressions land here too (e.g. third-party
-- compliance imports). reason explains why.
CREATE TABLE IF NOT EXISTS bi_suppressions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID REFERENCES bi_contacts(id) ON DELETE CASCADE,
  phone_e164      TEXT,
  email           TEXT,
  channel         TEXT NOT NULL DEFAULT 'all'
                  CHECK (channel IN ('all','sms','email','call')),
  reason          TEXT NOT NULL DEFAULT 'manual'
                  CHECK (reason IN ('manual','unsubscribe','bounce','complaint','imported','reply_negative')),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE bi_suppressions ADD COLUMN IF NOT EXISTS contact_id UUID;
ALTER TABLE bi_suppressions ADD COLUMN IF NOT EXISTS phone_e164 TEXT;
ALTER TABLE bi_suppressions ADD COLUMN IF NOT EXISTS email TEXT;
CREATE INDEX IF NOT EXISTS idx_bi_suppressions_contact ON bi_suppressions(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bi_suppressions_phone   ON bi_suppressions(phone_e164)  WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bi_suppressions_email   ON bi_suppressions(email)       WHERE email IS NOT NULL;

-- Mailbox health: per-mailbox rolling deliverability rollup.
-- Worker (Block 35) writes daily aggregates here.
CREATE TABLE IF NOT EXISTS bi_mailbox_health (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox           TEXT NOT NULL,
  channel           TEXT NOT NULL CHECK (channel IN ('sms','email')),
  window_start      DATE NOT NULL,
  sent              INT  NOT NULL DEFAULT 0,
  delivered         INT  NOT NULL DEFAULT 0,
  opened            INT  NOT NULL DEFAULT 0,
  clicked           INT  NOT NULL DEFAULT 0,
  replied           INT  NOT NULL DEFAULT 0,
  bounced           INT  NOT NULL DEFAULT 0,
  spam_complained   INT  NOT NULL DEFAULT 0,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE bi_mailbox_health ADD COLUMN IF NOT EXISTS mailbox TEXT;
ALTER TABLE bi_mailbox_health ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE bi_mailbox_health ADD COLUMN IF NOT EXISTS window_start TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_mailbox_health_day ON bi_mailbox_health(mailbox, channel, window_start);

COMMIT;
