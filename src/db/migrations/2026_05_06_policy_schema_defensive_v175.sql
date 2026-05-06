-- BI_SERVER_BLOCK_v175_POLICY_SCHEMA_DEFENSIVE_v1
-- bi_policies table + bi_applications.policy_id / policy_bound_at columns.
-- Code at src/modules/policy.service.ts, src/routes/biPolicyRoutes.ts,
-- src/modules/cancel.controller.ts, src/modules/claims.controller.ts
-- all reference bi_policies. No prior migration creates it. Plus v173's
-- policy.bound webhook handler stamps bi_applications.policy_id and
-- policy_bound_at. All idempotent.

CREATE TABLE IF NOT EXISTS bi_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL,
  policy_id TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','cancelled','lapsed','expired','claim_open','claim_closed')),
  effective_date DATE,
  expiry_date DATE,
  premium_amount NUMERIC,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bi_policies_application_unique UNIQUE (application_id)
);

ALTER TABLE bi_policies
  ADD COLUMN IF NOT EXISTS policy_id TEXT,
  ADD COLUMN IF NOT EXISTS effective_date DATE,
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS premium_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS bi_policies_application_idx
  ON bi_policies(application_id);

CREATE INDEX IF NOT EXISTS bi_policies_status_idx
  ON bi_policies(status);

-- Add policy tracking columns to bi_applications.
ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS policy_id TEXT,
  ADD COLUMN IF NOT EXISTS policy_bound_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS bi_applications_policy_id_idx
  ON bi_applications(policy_id) WHERE policy_id IS NOT NULL;

DO $$ BEGIN RAISE NOTICE 'BI_SERVER_BLOCK_v175_POLICY_SCHEMA_DEFENSIVE_v1 applied'; END $$;
