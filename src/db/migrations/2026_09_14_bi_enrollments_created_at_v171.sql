-- BI_ENROLL_LIVE_COLUMNS_v175 (supersedes the v171 body; v171 never applied)
-- bi_sequence_enrollments is created by THREE migrations, all CREATE TABLE
-- IF NOT EXISTS, and they disagree. live-schema.json (read from bi-pg01)
-- shows the live table is the v280 shape: started_at, no enrolled_at, no
-- created_at. The v171 backfill read enrolled_at, threw 42703, rolled back,
-- and re-threw on every boot. Resolve the source column at runtime instead
-- of guessing which twin won.
ALTER TABLE bi_sequence_enrollments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

DO $$
DECLARE src text;
BEGIN
  SELECT column_name INTO src
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name  = 'bi_sequence_enrollments'
     AND column_name IN ('started_at', 'enrolled_at')
   ORDER BY CASE column_name WHEN 'started_at' THEN 1 ELSE 2 END
   LIMIT 1;
  IF src IS NOT NULL THEN
    EXECUTE format(
      'UPDATE bi_sequence_enrollments SET created_at = COALESCE(created_at, %I, NOW()) WHERE created_at IS NULL',
      src);
  ELSE
    UPDATE bi_sequence_enrollments SET created_at = NOW() WHERE created_at IS NULL;
  END IF;
END $$;

ALTER TABLE bi_sequence_enrollments ALTER COLUMN created_at SET DEFAULT NOW();
