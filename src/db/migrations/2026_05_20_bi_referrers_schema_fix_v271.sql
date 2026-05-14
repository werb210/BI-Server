-- BI_SERVER_BLOCK_v271_BI_REFERRERS_SCHEMA_FIX_v1
-- S-1: align live bi_referrers schema with what biReferrerRoutes expects.
-- (a) full_name NOT NULL was set by the master schema and never relaxed
--     by a later migration. Referrer OTP-signup INSERT writes only
--     phone_e164, so every new-phone signup fails NOT NULL.
-- (b) Columns first_name, last_name, address_line2, intake_complete
--     only appear in a duplicate CREATE TABLE IF NOT EXISTS block in
--     2026_05_03_pgi_alignment_v1.sql — a no-op because the table
--     already exists. The /referrer/* routes reference intake_complete
--     on the row, so it always reads undefined.
-- Idempotent: every change uses IF NOT EXISTS / IF EXISTS / DROP NOT NULL
-- (which is a no-op if already nullable).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='bi_referrers' AND column_name='full_name'
       AND is_nullable='NO'
  ) THEN
    ALTER TABLE bi_referrers ALTER COLUMN full_name DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE bi_referrers ADD COLUMN IF NOT EXISTS first_name      TEXT;
ALTER TABLE bi_referrers ADD COLUMN IF NOT EXISTS last_name       TEXT;
ALTER TABLE bi_referrers ADD COLUMN IF NOT EXISTS address_line2   TEXT;
ALTER TABLE bi_referrers ADD COLUMN IF NOT EXISTS intake_complete BOOLEAN NOT NULL DEFAULT FALSE;
