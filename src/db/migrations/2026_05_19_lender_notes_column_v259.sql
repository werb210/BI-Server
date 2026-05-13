-- BI_SERVER_BLOCK_v259_REAL_SUBMISSION_FIX_v1
-- bi_applications.lender_notes is referenced in:
--   src/routes/biLenderApplicationCreate.ts (INSERT at line 110)
--   src/routes/biLenderApplicationDetail.ts (SELECT)
-- but no prior migration creates it. Adding as nullable TEXT.
ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS lender_notes TEXT;
