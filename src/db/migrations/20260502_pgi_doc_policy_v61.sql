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

CREATE TABLE IF NOT EXISTS bi_required_doc_catalog (
  doc_type bi_document_type PRIMARY KEY,
  display_label TEXT NOT NULL,
  description TEXT,
  if_startup BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO bi_required_doc_catalog (doc_type, display_label, description, if_startup, sort_order)
VALUES
  ('profit_loss',
   'Profit & Loss (last 12 months, monthly breakdown)',
   'Monthly P&L for the most recent 12 months.',
   FALSE, 10),
  ('balance_sheet',
   'Balance Sheet (most recent month-end)',
   'Most recent month-end balance sheet.',
   FALSE, 20),
  ('ar_aging',
   'Accounts Receivable Aging Summary (most recent)',
   'Most recent A/R aging summary.',
   FALSE, 30),
  ('ap_aging',
   'Accounts Payable Aging Summary (most recent)',
   'Most recent A/P aging summary.',
   FALSE, 40),
  ('founder_cv',
   'Founder CV (startups only)',
   'CV for each founder. Required only if the business is under 3 years old.',
   TRUE, 50),
  ('financial_forecast',
   'Financial Forecasts (startups only)',
   'Financial projections supporting the application. Required only if the business is under 3 years old.',
   TRUE, 60)
ON CONFLICT (doc_type) DO UPDATE
SET display_label = EXCLUDED.display_label,
    description = EXCLUDED.description,
    if_startup = EXCLUDED.if_startup,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS extracted_text TEXT;
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS ocr_status bi_ocr_status NOT NULL DEFAULT 'pending';
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS ocr_error TEXT;
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS ocr_completed_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_bi_documents_ocr_status ON bi_documents(ocr_status);
