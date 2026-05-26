-- BI_SERVER_BLOCK_v364_REFERRAL_SHORT_CODE_v1
-- Add a unique short_code (8 chars, base32, lower-case) to bi_referrals
-- so legacy ?ref=<short-code> URLs resolve. Existing rows get backfilled
-- with a deterministic code derived from their id so any URL that's
-- already in the wild keeps working as long as it was generated since
-- the schema added id columns.

ALTER TABLE bi_referrals
  ADD COLUMN IF NOT EXISTS short_code TEXT;

-- Backfill existing rows: take the first 8 hex chars of the id, lowercase.
-- Avoid collisions by skipping rows that already have a short_code set.
UPDATE bi_referrals
   SET short_code = LOWER(SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 8))
 WHERE short_code IS NULL;

-- Now make it unique + indexed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bi_referrals_short_code_unique
  ON bi_referrals (short_code)
  WHERE short_code IS NOT NULL;
