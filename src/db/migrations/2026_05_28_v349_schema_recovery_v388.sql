-- BI_SERVER_BLOCK_v388_SCHEMA_RECOVERY_AND_LENDER_ME_FIX_v1
--
-- Recovery for the v349 migration, which fails atomically on fresh
-- schemas. The root cause: v349's last step
--   CREATE INDEX ... WHERE doc_type IN ('loan_agreement', 'loan_agreement_signed');
-- uses the enum value 'loan_agreement' that was added in the SAME
-- transaction (ALTER TYPE bi_document_type ADD VALUE 'loan_agreement').
-- Postgres rejects this with:
--   ERROR: unsafe use of new value "loan_agreement" of enum type bi_document_type
-- The error aborts the transaction, rolling back ALL of v349's column
-- adds, constraint adds, and the bi_co_guarantors table create.
--
-- Production must have applied v349 successfully at an earlier point
-- (probably before the offending CREATE INDEX line was added), so
-- production rows have the columns. Fresh DBs (CI, new dev envs) get
-- nothing from v349 and any handler that touches q_ca_id_type /
-- has_co_guarantors / declarations silently fails its UPDATE — visible
-- in server logs as `[v350] declarations/has_co_guarantors update
-- failed: column "q_ca_id_type" does not exist` while the create still
-- returns 200 because the failing UPDATE is wrapped in .catch().
--
-- v388 re-adds everything v349 intended EXCEPT the offending enum/index
-- combo (the loan_agreement enum value is added in its own migration
-- below, separate from any index that uses it). All operations are
-- IF NOT EXISTS / IF EXISTS guarded so this is safe on a schema that
-- already has v349's state.

BEGIN;

-- 1. Q-keyed columns on bi_applications.
ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS q_business_province TEXT,
  ADD COLUMN IF NOT EXISTS q_ca_loan_type      TEXT,
  ADD COLUMN IF NOT EXISTS q_ca_id_type        TEXT,
  ADD COLUMN IF NOT EXISTS q_ca_id_number      TEXT,
  ADD COLUMN IF NOT EXISTS has_co_guarantors   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS declarations        JSONB,
  ADD COLUMN IF NOT EXISTS loan_agreement_uploaded_at TIMESTAMPTZ;

-- 2. CHECK constraints — drop-if-exists then add so re-runs don't error.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bi_applications_q_ca_loan_type_chk') THEN
    ALTER TABLE bi_applications DROP CONSTRAINT bi_applications_q_ca_loan_type_chk;
  END IF;
  ALTER TABLE bi_applications
    ADD CONSTRAINT bi_applications_q_ca_loan_type_chk
    CHECK (q_ca_loan_type IS NULL OR q_ca_loan_type IN ('Commercial Mortgage', 'Other Secured Loan'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bi_applications_q_business_province_chk') THEN
    ALTER TABLE bi_applications DROP CONSTRAINT bi_applications_q_business_province_chk;
  END IF;
  ALTER TABLE bi_applications
    ADD CONSTRAINT bi_applications_q_business_province_chk
    CHECK (q_business_province IS NULL OR q_business_province <> 'QC');

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bi_applications_loan_amount_max_chk') THEN
    ALTER TABLE bi_applications DROP CONSTRAINT bi_applications_loan_amount_max_chk;
  END IF;
  ALTER TABLE bi_applications
    ADD CONSTRAINT bi_applications_loan_amount_max_chk
    CHECK (loan_amount IS NULL OR loan_amount <= 1000000);

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bi_applications_pgi_limit_max_chk') THEN
    ALTER TABLE bi_applications DROP CONSTRAINT bi_applications_pgi_limit_max_chk;
  END IF;
  ALTER TABLE bi_applications
    ADD CONSTRAINT bi_applications_pgi_limit_max_chk
    CHECK (pgi_limit IS NULL OR pgi_limit <= 1000000);
END $$;

-- 3. bi_co_guarantors table.
CREATE TABLE IF NOT EXISTS bi_co_guarantors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES bi_applications(id) ON DELETE CASCADE,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  date_of_birth   DATE NOT NULL,
  phone           TEXT NOT NULL,
  address         TEXT NOT NULL,
  city            TEXT NOT NULL,
  province        TEXT NOT NULL,
  postal_code     TEXT NOT NULL,
  relationship    TEXT NOT NULL DEFAULT 'Guarantor',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bi_co_guarantors_province_chk CHECK (province <> 'QC')
);
CREATE INDEX IF NOT EXISTS idx_bi_co_guarantors_app ON bi_co_guarantors(application_id);

COMMIT;

-- 4. PGI document enum values — outside the main transaction so the index
--    add below (in a third transaction) can use them. ALTER TYPE ADD VALUE
--    has implicit-commit semantics so each runs standalone safely.
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'loan_agreement';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'profit_loss';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'balance_sheet';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'ar_aging';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'ap_aging';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'founder_cv';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'financial_forecast';

-- 5. Index using the newly-committed enum values. In its own transaction
--    so the enum values from step 4 are visible.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_bi_documents_loan_agreement
  ON bi_documents(application_id)
  WHERE doc_type IN ('loan_agreement', 'loan_agreement_signed');
COMMIT;
