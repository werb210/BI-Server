-- BI_SERVER_BLOCK_81_BI_CONTACTS_FIRST_LAST_NAME_v1
-- Add first_name + last_name to bi_contacts and backfill from full_name.
-- biCrmRoutes.ts has been selecting / updating these columns since Block
-- 74 merged, but the columns don't exist -> every list and detail GET
-- returns 500. Idempotent (IF NOT EXISTS guards + WHERE-null backfill).

BEGIN;

ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS last_name  TEXT;

-- Backfill: split full_name on the first run of whitespace. Single-token
-- names go entirely into first_name. Multi-token names: first token to
-- first_name, remainder (joined) to last_name. Only run on rows where
-- both new columns are null and full_name is non-empty.
UPDATE bi_contacts
   SET first_name = TRIM(SPLIT_PART(full_name, ' ', 1)),
       last_name  = NULLIF(TRIM(REGEXP_REPLACE(full_name, '^\s*\S+\s*', '')), '')
 WHERE first_name IS NULL
   AND last_name  IS NULL
   AND full_name IS NOT NULL
   AND BTRIM(full_name) <> '';

CREATE INDEX IF NOT EXISTS idx_bi_contacts_first_name ON bi_contacts(first_name);
CREATE INDEX IF NOT EXISTS idx_bi_contacts_last_name  ON bi_contacts(last_name);

COMMIT;
