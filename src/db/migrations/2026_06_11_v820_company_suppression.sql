-- BI_SERVER_BLOCK_v820_CRM_DELETE_SUPPRESSION
-- Companies have no email/phone, so they could never be suppressed. Allow a
-- 'company' channel keyed by lower(legal_name) in identifier. Idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='bi_suppressions') THEN
    ALTER TABLE bi_suppressions DROP CONSTRAINT IF EXISTS bi_suppressions_channel_check;
    ALTER TABLE bi_suppressions
      ADD CONSTRAINT bi_suppressions_channel_check
      CHECK (channel IN ('email','sms','all','company')) NOT VALID;
  END IF;
END $$;
