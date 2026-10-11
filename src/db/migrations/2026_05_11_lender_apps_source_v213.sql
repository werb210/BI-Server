-- BI_SERVER_BLOCK_v213_LENDER_APPLICATIONS_POST_v1
-- Add source + lender_id columns so lender-submitted apps are distinguishable
-- and queryable by submitting lender. Idempotent; safe to run repeatedly.
-- BI_SERVER_BLOCK_v789_IDEMPOTENT: native IF NOT EXISTS guards (the information_schema /
-- pg_indexes lookups were not schema-qualified, so a same-named table or index in another
-- schema could skip the change here and the runner no longer swallows the resulting error).
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'public';
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS lender_id UUID NULL;
CREATE INDEX IF NOT EXISTS idx_bi_applications_lender_id ON bi_applications(lender_id);
