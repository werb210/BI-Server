-- v341: defensive table creation for runtime-queried tables that lack
-- a migration. Schemas are minimal but match what controllers SELECT.
-- All idempotent. Full schemas will land in their respective feature
-- migrations once those features are launched.

BEGIN;

CREATE TABLE IF NOT EXISTS bi_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID,
  type            TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  silo            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_events_app ON bi_events(application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bi_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_jobs_status ON bi_jobs(status, scheduled_at) WHERE status IN ('pending','running');

CREATE TABLE IF NOT EXISTS bi_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID,
  policy_number   TEXT,
  status          TEXT NOT NULL DEFAULT 'opened',
  amount_claimed  NUMERIC(14,2),
  amount_paid     NUMERIC(14,2),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_claims_app ON bi_claims(application_id);

CREATE TABLE IF NOT EXISTS bi_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID,
  entry_type      TEXT NOT NULL,
  amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'CAD',
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_ledger_app ON bi_ledger(application_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS bi_premium_schedule (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID,
  due_date        DATE NOT NULL,
  amount          NUMERIC(14,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'scheduled',
  paid_at         TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_premium_app ON bi_premium_schedule(application_id, due_date);

CREATE TABLE IF NOT EXISTS bi_payout_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number    TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  cutoff_at       TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bi_commission_payables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID,
  recipient_id    UUID,
  recipient_type  TEXT,
  amount          NUMERIC(14,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'accruing',
  batch_id        UUID REFERENCES bi_payout_batches(id) ON DELETE SET NULL,
  earned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at         TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_commission_status ON bi_commission_payables(status, earned_at) WHERE status IN ('accruing','batched');

COMMIT;
