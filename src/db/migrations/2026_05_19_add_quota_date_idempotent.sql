-- BI_SERVER_BLOCK_v319_QUOTA_DATE_IDEMPOTENT_v1
-- Adds quota_date column if it doesn't exist. Idempotent.
-- The sequenceSendWorker queries this column every 60s; production
-- has been throwing 42703 errors continuously.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bi_user_send_quotas'
      AND column_name = 'quota_date'
  ) THEN
    ALTER TABLE bi_user_send_quotas
      ADD COLUMN quota_date DATE NOT NULL DEFAULT CURRENT_DATE;
    CREATE INDEX IF NOT EXISTS idx_bi_user_send_quotas_quota_date
      ON bi_user_send_quotas(quota_date);
  END IF;
END $$;
