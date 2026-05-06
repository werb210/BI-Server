-- BI_SERVER_BLOCK_v170_SCORE_PHONE_NOT_NULL_FIX_v1
-- Drop NOT NULL on bi_applications.applicant_phone_e164. The column
-- was created NOT NULL in 20260222_00_bi_master_schema.sql but every
-- subsequent INSERT path (public score, lender API) either omits it
-- entirely or inserts placeholder values. Per V1 ruling 5 the phone
-- is the applicant's OTP'd identity — owned by public flow only;
-- lender/referrer flows identify by other means and shouldn't be
-- forced to fabricate a phone.
--
-- Idempotent: DO block guards on is_nullable so repeat runs no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'bi_applications'
      AND column_name = 'applicant_phone_e164'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE bi_applications ALTER COLUMN applicant_phone_e164 DROP NOT NULL;
    RAISE NOTICE 'bi_applications.applicant_phone_e164 NOT NULL dropped (v170)';
  ELSE
    RAISE NOTICE 'bi_applications.applicant_phone_e164 already nullable — v170 no-op';
  END IF;
END $$;
