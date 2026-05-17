-- BI_SERVER_BLOCK_46_v1
-- 1. Create the seven BI marketing tables that the marketing
--    worker (workers/marketingWorker.ts) + the marketing routes
--    (routes/biMarketingRoutes.ts) expect. The v280 migration that
--    should have made them is missing from this deployment.
--
-- 2. Loosen bi_applications.status CHECK so 'sent_to_pgi' is
--    allowed. Without this, the legacy backfill migration
--    2026_05_15_legacy_submitted_to_sent_to_pgi_v243.sql crashes on
--    every restart, leaving legacy rows stuck at status='submitted'.
--    Both 'submitted' and 'sent_to_pgi' need to remain valid
--    indefinitely since the application pipeline uses both.

-- ── 1a. bi_sequences ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bi_sequences (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  channel      TEXT NOT NULL DEFAULT 'email'
                CHECK (channel IN ('email', 'sms')),
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_sequences_status ON bi_sequences (status);

-- ── 1b. bi_sequence_steps ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bi_sequence_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id   UUID NOT NULL REFERENCES bi_sequences(id) ON DELETE CASCADE,
  step_order    SMALLINT NOT NULL,
  delay_days    INTEGER NOT NULL DEFAULT 0,
  subject       TEXT,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sequence_id, step_order)
);
CREATE INDEX IF NOT EXISTS idx_bi_sequence_steps_seq ON bi_sequence_steps (sequence_id);

-- ── 1c. bi_sequence_lists ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bi_sequence_lists (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 1d. bi_sequence_enrollments ──────────────────────────────────
CREATE TABLE IF NOT EXISTS bi_sequence_enrollments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id    UUID NOT NULL REFERENCES bi_sequences(id) ON DELETE CASCADE,
  contact_id     UUID NOT NULL,
  list_id        UUID REFERENCES bi_sequence_lists(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'paused', 'completed', 'unsubscribed', 'bounced', 'replied')),
  current_step   SMALLINT NOT NULL DEFAULT 0,
  next_due_at    TIMESTAMPTZ,
  enrolled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  paused_at      TIMESTAMPTZ,
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sequence_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_bi_seq_enrollments_due
  ON bi_sequence_enrollments (next_due_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bi_seq_enrollments_contact
  ON bi_sequence_enrollments (contact_id);

-- ── 1e. bi_sequence_events ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS bi_sequence_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id   UUID NOT NULL REFERENCES bi_sequence_enrollments(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  step_order      SMALLINT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_seq_events_enrollment
  ON bi_sequence_events (enrollment_id, created_at DESC);

-- ── 1f. bi_suppressions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bi_suppressions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier   TEXT NOT NULL,
  channel      TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'all')),
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (identifier, channel)
);

-- ── 1g. bi_mailbox_health ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bi_mailbox_health (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox         TEXT NOT NULL,
  day             DATE NOT NULL,
  sent_count      INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  bounce_count    INTEGER NOT NULL DEFAULT 0,
  reply_count     INTEGER NOT NULL DEFAULT 0,
  spam_count      INTEGER NOT NULL DEFAULT 0,
  open_count      INTEGER NOT NULL DEFAULT 0,
  click_count     INTEGER NOT NULL DEFAULT 0,
  unsubscribe_count INTEGER NOT NULL DEFAULT 0,
  health_score    NUMERIC(5,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mailbox, day)
);
CREATE INDEX IF NOT EXISTS idx_bi_mailbox_health_day
  ON bi_mailbox_health (day DESC);

-- ── 2. Loosen bi_applications.status CHECK ───────────────────────
-- Add 'sent_to_pgi' to the allowed status values. Without this, the
-- legacy backfill migration v243 fails on every restart with
-- "violates check constraint bi_applications_status_check".
-- Re-runnable: DROP + ADD with IF EXISTS guards.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'bi_applications_status_check'
       AND conrelid = 'bi_applications'::regclass
  ) THEN
    ALTER TABLE bi_applications DROP CONSTRAINT bi_applications_status_check;
  END IF;

  ALTER TABLE bi_applications
    ADD CONSTRAINT bi_applications_status_check
    CHECK (status IN (
      'created',
      'in_progress',
      'document_review',
      'ready_for_submission',
      'submitted',
      'sent_to_pgi',
      'under_review',
      'information_required',
      'approved',
      'declined',
      'policy_issued'
    ));
END $$;
