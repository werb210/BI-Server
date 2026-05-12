-- BI_SERVER_BLOCK_v238_REFERRER_PORTAL_v1
ALTER TABLE bi_referrers ALTER COLUMN email DROP NOT NULL;
ALTER TABLE bi_referrers ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE bi_referrers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE bi_referrers ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE bi_referrers ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE bi_referrers ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'CA';
ALTER TABLE bi_referrers ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMP;
ALTER TABLE bi_referrers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_referrers_phone ON bi_referrers(phone_e164);
ALTER TABLE bi_referrals ADD COLUMN IF NOT EXISTS ref_code TEXT;
ALTER TABLE bi_referrals ADD COLUMN IF NOT EXISTS sms_sent_at TIMESTAMP;
ALTER TABLE bi_referrals ADD COLUMN IF NOT EXISTS matched_at TIMESTAMP;
ALTER TABLE bi_referrals ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE bi_referrals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_referrals_ref_code ON bi_referrals(ref_code) WHERE ref_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bi_referrals_email_lower ON bi_referrals(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bi_referrals_phone_e164 ON bi_referrals(phone_e164) WHERE phone_e164 IS NOT NULL;
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS referrer_id UUID;
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS referral_id UUID;
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS referrer_code TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name='bi_applications' AND column_name='referrer_id'
      AND constraint_name='fk_bi_applications_referrer'
  ) THEN
    ALTER TABLE bi_applications
      ADD CONSTRAINT fk_bi_applications_referrer
      FOREIGN KEY (referrer_id) REFERENCES bi_referrers(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name='bi_applications' AND column_name='referral_id'
      AND constraint_name='fk_bi_applications_referral'
  ) THEN
    ALTER TABLE bi_applications
      ADD CONSTRAINT fk_bi_applications_referral
      FOREIGN KEY (referral_id) REFERENCES bi_referrals(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bi_applications_referrer ON bi_applications(referrer_id) WHERE referrer_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS bi_referrer_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES bi_referrers(id),
  referral_id UUID REFERENCES bi_referrals(id),
  application_id UUID NOT NULL REFERENCES bi_applications(id),
  bi_commission_id UUID REFERENCES bi_commissions(id),
  amount NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'accrued',
  accrued_at TIMESTAMP NOT NULL DEFAULT NOW(),
  payable_at TIMESTAMP,
  paid_at TIMESTAMP,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_bi_referrer_commissions_referrer ON bi_referrer_commissions(referrer_id);
CREATE INDEX IF NOT EXISTS idx_bi_referrer_commissions_app ON bi_referrer_commissions(application_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_referrer_commissions_app_referrer
  ON bi_referrer_commissions(application_id, referrer_id);
