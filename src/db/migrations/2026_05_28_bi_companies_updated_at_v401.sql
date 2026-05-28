-- BI_SERVER_BLOCK_v401 — restore bi_companies.updated_at
-- Production BI-Server startup logs "column updated_at of relation
-- bi_companies does not exist". Add the column idempotently and
-- backfill from created_at so older rows have a value.
ALTER TABLE bi_companies
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE bi_companies
  ALTER COLUMN updated_at SET DEFAULT NOW();

UPDATE bi_companies
   SET updated_at = COALESCE(created_at, NOW())
 WHERE updated_at IS NULL;

ALTER TABLE bi_companies
  ALTER COLUMN updated_at SET NOT NULL;
