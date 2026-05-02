-- BI_BLOCK_PGI_ALIGNMENT_v1 (idempotent, normalize-then-constrain)

-- ---------- 1.1 Pipeline stages ----------
ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS status_legacy TEXT;

UPDATE bi_applications
   SET status_legacy = status::text
 WHERE status_legacy IS NULL;

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'bi_applications'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE bi_applications DROP CONSTRAINT %I', c.conname);
  END LOOP;
END$$;

DO $$
DECLARE coltype TEXT;
BEGIN
  SELECT data_type INTO coltype
    FROM information_schema.columns
   WHERE table_name = 'bi_applications' AND column_name = 'status';
  IF coltype = 'USER-DEFINED' THEN
    ALTER TABLE bi_applications ALTER COLUMN status TYPE TEXT USING status::text;
    RAISE NOTICE 'status column converted from enum to TEXT';
  END IF;
END$$;

UPDATE bi_applications
   SET status = CASE LOWER(COALESCE(NULLIF(TRIM(status), ''), 'created'))
       WHEN 'created' THEN 'created'
       WHEN 'new_application' THEN 'created'
       WHEN 'in_progress' THEN 'in_progress'
       WHEN 'documents_pending' THEN 'document_review'
       WHEN 'document_review' THEN 'document_review'
       WHEN 'requires_docs' THEN 'document_review'
       WHEN 'internal_review' THEN 'ready_for_submission'
       WHEN 'ready_for_submission' THEN 'ready_for_submission'
       WHEN 'submitted_to_insurer' THEN 'submitted'
       WHEN 'submitted' THEN 'submitted'
       WHEN 'under_review' THEN 'under_review'
       WHEN 'pending' THEN 'under_review'
       WHEN 'information_required' THEN 'information_required'
       WHEN 'info_required' THEN 'information_required'
       WHEN 'quoted' THEN 'approved'
       WHEN 'approved' THEN 'approved'
       WHEN 'declined' THEN 'declined'
       WHEN 'rejected' THEN 'declined'
       WHEN 'bound' THEN 'policy_issued'
       WHEN 'policy_issued' THEN 'policy_issued'
       ELSE 'created'
     END;

ALTER TABLE bi_applications
  ADD CONSTRAINT bi_applications_status_check
  CHECK (status IN (
    'created','in_progress','document_review','ready_for_submission',
    'submitted','under_review','information_required',
    'approved','declined','policy_issued'
  ));

ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS form_data JSONB,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS naics_code TEXT,
  ADD COLUMN IF NOT EXISTS formation_date DATE,
  ADD COLUMN IF NOT EXISTS loan_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS pgi_limit NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS annual_revenue NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS ebitda NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS total_debt NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS monthly_debt_service NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS collateral_value NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS enterprise_value NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS bankruptcy_history BOOLEAN,
  ADD COLUMN IF NOT EXISTS insolvency_history BOOLEAN,
  ADD COLUMN IF NOT EXISTS judgment_history BOOLEAN,
  ADD COLUMN IF NOT EXISTS guarantor_name TEXT,
  ADD COLUMN IF NOT EXISTS guarantor_email TEXT,
  ADD COLUMN IF NOT EXISTS business_name TEXT,
  ADD COLUMN IF NOT EXISTS lender_name TEXT,
  ADD COLUMN IF NOT EXISTS facility_type TEXT,
  ADD COLUMN IF NOT EXISTS coverage_percentage NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS score_id TEXT,
  ADD COLUMN IF NOT EXISTS score_value INTEGER,
  ADD COLUMN IF NOT EXISTS score_decision TEXT,
  ADD COLUMN IF NOT EXISTS score_reason TEXT,
  ADD COLUMN IF NOT EXISTS score_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pgi_application_id TEXT,
  ADD COLUMN IF NOT EXISTS quote_id TEXT,
  ADD COLUMN IF NOT EXISTS underwriter_ref TEXT,
  ADD COLUMN IF NOT EXISTS annual_premium NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS quote_valid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS lender_id UUID,
  ADD COLUMN IF NOT EXISTS referrer_id UUID;

ALTER TABLE bi_applications
  ADD CONSTRAINT bi_applications_facility_type_check
  CHECK (facility_type IS NULL OR facility_type IN ('secured','unsecured'));

ALTER TABLE bi_applications
  ADD CONSTRAINT bi_applications_score_decision_check
  CHECK (score_decision IS NULL OR score_decision IN ('approve','decline','pending','error'));

CREATE INDEX IF NOT EXISTS bi_applications_status_idx ON bi_applications(status);
CREATE INDEX IF NOT EXISTS bi_applications_lender_id_idx ON bi_applications(lender_id);
CREATE INDEX IF NOT EXISTS bi_applications_referrer_id_idx ON bi_applications(referrer_id);
CREATE INDEX IF NOT EXISTS bi_applications_pgi_app_id_idx ON bi_applications(pgi_application_id);

ALTER TABLE bi_documents
  ADD COLUMN IF NOT EXISTS document_type_legacy TEXT;

UPDATE bi_documents
   SET document_type_legacy = document_type
 WHERE document_type_legacy IS NULL;

UPDATE bi_documents
   SET document_type = CASE LOWER(COALESCE(NULLIF(TRIM(document_type), ''), ''))
       WHEN 'profit_loss' THEN 'profit_loss'
       WHEN 'p_l' THEN 'profit_loss'
       WHEN 'pnl' THEN 'profit_loss'
       WHEN 'income_statement' THEN 'profit_loss'
       WHEN 'balance_sheet' THEN 'balance_sheet'
       WHEN 'bs' THEN 'balance_sheet'
       WHEN 'ar_aging' THEN 'ar_aging'
       WHEN 'accounts_receivable' THEN 'ar_aging'
       WHEN 'ap_aging' THEN 'ap_aging'
       WHEN 'accounts_payable' THEN 'ap_aging'
       WHEN 'founder_cv' THEN 'founder_cv'
       WHEN 'cv' THEN 'founder_cv'
       WHEN 'resume' THEN 'founder_cv'
       WHEN 'financial_forecast' THEN 'financial_forecast'
       WHEN 'forecast' THEN 'financial_forecast'
       WHEN 'projections' THEN 'financial_forecast'
       WHEN 'financial_statements' THEN 'profit_loss'
       WHEN 'bank_statements' THEN 'balance_sheet'
       WHEN 'government_id' THEN NULL
       ELSE NULL
     END;

DO $$
DECLARE q INT;
BEGIN
  SELECT COUNT(*) INTO q FROM bi_documents WHERE document_type IS NULL;
  IF q > 0 THEN
    RAISE WARNING 'Quarantined % bi_documents rows with unmappable type (document_type_legacy preserved)', q;
  END IF;
END$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bi_documents_type_check') THEN
    ALTER TABLE bi_documents DROP CONSTRAINT bi_documents_type_check;
  END IF;
  ALTER TABLE bi_documents
    ADD CONSTRAINT bi_documents_type_check
    CHECK (document_type IS NULL OR document_type IN (
      'profit_loss','balance_sheet','ar_aging','ap_aging','founder_cv','financial_forecast'
    ));
END$$;

CREATE TABLE IF NOT EXISTS bi_lender_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_id UUID NOT NULL REFERENCES lenders(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  label TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS bi_lender_api_keys_lender_idx ON bi_lender_api_keys(lender_id);
CREATE UNIQUE INDEX IF NOT EXISTS bi_lender_api_keys_hash_idx ON bi_lender_api_keys(key_hash);

CREATE TABLE IF NOT EXISTS bi_referrers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  company_name TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  country TEXT,
  etransfer_email TEXT,
  intake_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bi_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES bi_referrers(id) ON DELETE CASCADE,
  contact_id UUID,
  application_id UUID REFERENCES bi_applications(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  company_name TEXT,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bi_referrals_referrer_idx ON bi_referrals(referrer_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'bi_contacts' AND column_name = 'tags'
  ) THEN
    ALTER TABLE bi_contacts ADD COLUMN tags TEXT[] DEFAULT '{}';
  END IF;
END$$;

DO $$ BEGIN RAISE NOTICE 'BI_BLOCK_PGI_ALIGNMENT_v1 applied'; END $$;
