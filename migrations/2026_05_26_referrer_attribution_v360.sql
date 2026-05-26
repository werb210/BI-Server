-- BI_SERVER_BLOCK_v360_REFERRER_ATTRIBUTION_v1
-- Ensure bi_referrals.status allows the 'applied' transition + the bi_applications
-- referrer_id/referral_id columns exist (master schema has them; defensive add).

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

-- Status transitions: invited -> applied -> approved.
-- Use a permissive text constraint rather than enum so we don't have to
-- recreate the type on each new value.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'bi_referrals' AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  ) THEN
    -- Existing check constraint — drop + recreate with widened values.
    EXECUTE (SELECT 'ALTER TABLE bi_referrals DROP CONSTRAINT ' || quote_ident(c.conname)
               FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
              WHERE t.relname = 'bi_referrals' AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%status%' LIMIT 1);
  END IF;
END
$$;

ALTER TABLE bi_referrals
  ADD CONSTRAINT bi_referrals_status_check
  CHECK (status IN ('invited','applied','approved','bound','declined','cancelled'));
