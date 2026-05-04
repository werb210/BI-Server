-- BI_SERVER_BLOCK_v64_DOC_POLICY_SPLIT_v1 — Part A: enum changes only
-- The original v61 migration combined ALTER TYPE ADD VALUE with INSERTs that
-- used the new values in the SAME transaction, which Postgres rejects with
-- "unsafe use of new value ... New enum values must be committed before they
-- can be used." That rolled back the entire migration, leaving the BI-Server
-- schema incomplete on every boot. Splitting into two files (= two
-- transactions) is the canonical fix.
--
-- Idempotent via IF EXISTS / IF NOT EXISTS / ADD VALUE IF NOT EXISTS.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bi_document_type') THEN
    ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'profit_loss';
    ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'balance_sheet';
    ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'ar_aging';
    ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'ap_aging';
    ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'founder_cv';
    ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'financial_forecast';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bi_ocr_status') THEN
    CREATE TYPE bi_ocr_status AS ENUM ('pending','processing','complete','failed','skipped');
  END IF;
END $$;
