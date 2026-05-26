-- BI_SERVER_BLOCK_v360_REFERRER_ATTRIBUTION_v1
-- BI_SERVER_BLOCK_v363_RELOCATE_MIGRATIONS_v1 — relocated from /migrations/
-- to /src/db/migrations/ per guardrails workflow + runMigrations boot path.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='bi_applications' AND column_name='referrer_id'
  ) THEN
    ALTER TABLE bi_applications ADD COLUMN referrer_id UUID REFERENCES bi_referrers(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='bi_applications' AND column_name='referral_id'
  ) THEN
    ALTER TABLE bi_applications ADD COLUMN referral_id UUID REFERENCES bi_referrals(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_bi_applications_referral_id ON bi_applications(referral_id) WHERE referral_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bi_applications_referrer_id ON bi_applications(referrer_id) WHERE referrer_id IS NOT NULL;

DO $$
DECLARE
  cn TEXT;
BEGIN
  SELECT c.conname INTO cn
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
   WHERE t.relname = 'bi_referrals'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%status%'
   LIMIT 1;
  IF cn IS NOT NULL THEN
    EXECUTE format('ALTER TABLE bi_referrals DROP CONSTRAINT %I', cn);
  END IF;
END
$$;

ALTER TABLE bi_referrals
  ADD CONSTRAINT bi_referrals_status_check
  CHECK (status IN ('invited','applied','approved','bound','declined','cancelled'));
