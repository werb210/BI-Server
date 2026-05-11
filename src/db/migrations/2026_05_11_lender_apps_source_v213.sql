-- BI_SERVER_BLOCK_v213_LENDER_APPLICATIONS_POST_v1
-- Add source + lender_id columns so lender-submitted apps are distinguishable
-- and queryable by submitting lender. Idempotent; safe to run repeatedly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='bi_applications' AND column_name='source'
  ) THEN
    ALTER TABLE bi_applications ADD COLUMN source TEXT DEFAULT 'public';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='bi_applications' AND column_name='lender_id'
  ) THEN
    ALTER TABLE bi_applications ADD COLUMN lender_id UUID NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename='bi_applications' AND indexname='idx_bi_applications_lender_id'
  ) THEN
    CREATE INDEX idx_bi_applications_lender_id ON bi_applications(lender_id);
  END IF;
END $$;
