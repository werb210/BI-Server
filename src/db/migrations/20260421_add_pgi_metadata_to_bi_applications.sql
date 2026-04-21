ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS pgi_external_id TEXT,
  ADD COLUMN IF NOT EXISTS quote_summary JSONB,
  ADD COLUMN IF NOT EXISTS quote_expiry_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS underwriter_ref TEXT,
  ADD COLUMN IF NOT EXISTS coverage_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS lender_name TEXT,
  ADD COLUMN IF NOT EXISTS guarantor_name TEXT,
  ADD COLUMN IF NOT EXISTS guarantor_email TEXT;

CREATE INDEX IF NOT EXISTS idx_bi_applications_pgi_external_id ON bi_applications(pgi_external_id);
