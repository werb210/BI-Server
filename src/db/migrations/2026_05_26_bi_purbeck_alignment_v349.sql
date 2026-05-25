-- BI_SERVER_BLOCK_v349_PURBECK_ALIGNMENT_v1
-- Schema additions for the Purbeck-aligned partner schema. Idempotent.
-- Pattern per ruling #19: ALTER TABLE ... ADD COLUMN IF NOT EXISTS,
-- not CREATE TABLE IF NOT EXISTS + CREATE INDEX on new columns.

BEGIN;

-- 1. New q-keyed columns on bi_applications.
-- Legacy columns (guarantor_name, business_name, naics_code, etc.) STAY
-- for read fallback during the transition. New q-keyed columns become
-- the authoritative source; legacy ones are still written for now.
ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS q_business_province TEXT,
  ADD COLUMN IF NOT EXISTS q_ca_loan_type      TEXT,
  ADD COLUMN IF NOT EXISTS q_ca_id_type        TEXT,
  ADD COLUMN IF NOT EXISTS q_ca_id_number      TEXT,
  ADD COLUMN IF NOT EXISTS has_co_guarantors   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS declarations        JSONB,
  ADD COLUMN IF NOT EXISTS loan_agreement_uploaded_at TIMESTAMPTZ;

-- 2. CHECK constraints. Defensive defaults; enforced at validation layer
-- too. Quebec block + loan type allowlist + 1M caps.
DO $$
BEGIN
  -- Drop existing constraint if present so re-runs don't error.
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bi_applications_q_ca_loan_type_chk'
  ) THEN
    ALTER TABLE bi_applications DROP CONSTRAINT bi_applications_q_ca_loan_type_chk;
  END IF;
  ALTER TABLE bi_applications
    ADD CONSTRAINT bi_applications_q_ca_loan_type_chk
    CHECK (q_ca_loan_type IS NULL OR q_ca_loan_type IN ('Commercial Mortgage', 'Other Secured Loan'));

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bi_applications_q_business_province_chk'
  ) THEN
    ALTER TABLE bi_applications DROP CONSTRAINT bi_applications_q_business_province_chk;
  END IF;
  ALTER TABLE bi_applications
    ADD CONSTRAINT bi_applications_q_business_province_chk
    CHECK (q_business_province IS NULL OR q_business_province <> 'QC');

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bi_applications_loan_amount_max_chk'
  ) THEN
    ALTER TABLE bi_applications DROP CONSTRAINT bi_applications_loan_amount_max_chk;
  END IF;
  ALTER TABLE bi_applications
    ADD CONSTRAINT bi_applications_loan_amount_max_chk
    CHECK (loan_amount IS NULL OR loan_amount <= 1000000);

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bi_applications_pgi_limit_max_chk'
  ) THEN
    ALTER TABLE bi_applications DROP CONSTRAINT bi_applications_pgi_limit_max_chk;
  END IF;
  ALTER TABLE bi_applications
    ADD CONSTRAINT bi_applications_pgi_limit_max_chk
    CHECK (pgi_limit IS NULL OR pgi_limit <= 1000000);
END $$;

-- 3. Co-guarantor table (per-application, repeatable).
-- Schema mirrors fields visible in PGI's co-guarantor expand modal.
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

-- 4. New PGI document types (additive enum values for Purbeck submission).
-- Existing 'loan_agreement_signed' stays for legacy data. New 'loan_agreement'
-- is the value PGI's partner API expects.
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'loan_agreement';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'profit_loss';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'balance_sheet';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'ar_aging';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'ap_aging';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'founder_cv';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'financial_forecast';

-- 5. Index to look up loan_agreement presence quickly for the submit gate.
-- Partial index keeps it small (only the doc type we gate on).
CREATE INDEX IF NOT EXISTS idx_bi_documents_loan_agreement
  ON bi_documents(application_id)
  WHERE doc_type IN ('loan_agreement', 'loan_agreement_signed');

COMMIT;
