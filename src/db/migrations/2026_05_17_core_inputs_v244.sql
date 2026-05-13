-- BI_SERVER_BLOCK_v244_LIVE_TEST_FIXES_v1
-- core_inputs is INSERTed by biLenderApplicationCreate and SELECTed
-- elsewhere. The column never got a migration; on clean DBs every
-- lender app INSERT and pipeline SELECT 500s. Idempotent ADD so this
-- is safe whether the prod DB already has the column or not.
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS core_inputs JSONB;
