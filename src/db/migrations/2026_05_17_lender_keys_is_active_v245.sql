-- BI_SERVER_BLOCK_v245_LIVE_TEST_FIXES_PT2_v1
-- Canonical schema (20260428) defined is_active. Defensive ALTER for
-- any environment whose table predates that column.
ALTER TABLE bi_lender_api_keys ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE bi_lender_api_keys ADD COLUMN IF NOT EXISTS key_prefix TEXT;
ALTER TABLE bi_lender_api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='bi_lender_api_keys' AND column_name='active') THEN
    UPDATE bi_lender_api_keys SET is_active = active WHERE is_active IS DISTINCT FROM active;
  END IF;
END $$;
