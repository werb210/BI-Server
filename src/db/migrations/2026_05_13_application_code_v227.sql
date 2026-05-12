-- BI_SERVER_BLOCK_v227_APPLICATION_CODE_AND_DEMO_FIXUP_v1
-- v213 introduced application_code in code paths but never added the column.
-- Production GET /lender/applications/mine and POST /lender/applications
-- have been 500-ing since v223 mounted biLenderApplicationCreate first.

ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS application_code TEXT;

-- Backfill from public_id so any old URLs that resolved via public_id keep
-- working when the frontend switches to application_code-first lookup.
UPDATE bi_applications
   SET application_code = public_id
 WHERE application_code IS NULL
   AND public_id IS NOT NULL;

-- Partial unique index so two NULLs can coexist while ensuring uniqueness
-- among populated rows. NOT used by ON CONFLICT — only as a duplicate guard
-- on the application generator.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_applications_application_code
  ON bi_applications(application_code) WHERE application_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bi_applications_application_code
  ON bi_applications(application_code);
