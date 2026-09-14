-- BI_SEQ_ENROLL_DIAG_COLUMN_v171
-- bi_sequence_enrollments is created by two migrations, both with
-- CREATE TABLE IF NOT EXISTS:
--   2026_05_18_bi_sequences_v110.sql  -> enrolled_at, no created_at  (ran first)
--   2026_05_17_bi_marketing_tables... -> created_at                  (never applied)
-- The live table therefore has no created_at, and the enroll diagnostic that
-- reads e.created_at threw 42703 on every call. The query is fixed to use
-- enrolled_at; this adds the column too so the two definitions stop disagreeing
-- and any other code expecting created_at does not hit the same wall.
--
-- Backfilled from enrolled_at, which is the same moment for existing rows.
ALTER TABLE bi_sequence_enrollments
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE bi_sequence_enrollments
   SET created_at = COALESCE(created_at, enrolled_at, NOW())
 WHERE created_at IS NULL;

ALTER TABLE bi_sequence_enrollments
  ALTER COLUMN created_at SET DEFAULT NOW();
