-- BI_COVERAGE_GAPS_v26
-- Preserve labels and referral work for contract coverages that are unavailable
-- in the application's country.

CREATE TABLE IF NOT EXISTS bi_coverage_labels (
  coverage_code TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO bi_coverage_labels (coverage_code, display_name) VALUES
  ('cgl','Commercial General Liability'),
  ('cpl','Contractors Pollution Liability'),
  ('builders_risk','Builder''s Risk (Course of Construction)'),
  ('contractor_equipment','Contractors Equipment'),
  ('eo','Professional Liability (Errors and Omissions)'),
  ('cyber','Cyber Liability'),
  ('do','Management Liability (D&O)'),
  ('surety_bid','Contract Surety - Bid Bond'),
  ('surety_performance','Contract Surety - Performance Bond'),
  ('surety_payment','Contract Surety - Labour and Material Payment Bond'),
  ('surety_maintenance','Contract Surety - Maintenance Bond'),
  ('pgi','Personal Guarantee Insurance'),
  ('trade_credit','Trade Credit Insurance'),
  ('transactional','Transaction Liability')
ON CONFLICT (coverage_code) DO UPDATE
  SET display_name = EXCLUDED.display_name, updated_at = NOW();

CREATE TABLE IF NOT EXISTS bi_coverage_gaps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES bi_applications(id) ON DELETE CASCADE,
  coverage_code   TEXT NOT NULL,
  country         TEXT NOT NULL CHECK (country IN ('CA','US')),
  requested_limit NUMERIC(14,2),
  limit_basis     TEXT,
  clause_text     TEXT,
  source          TEXT NOT NULL DEFAULT 'contract'
                  CHECK (source IN ('contract','client_request')),
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','referred','placed','declined','closed')),
  staff_note      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, coverage_code)
);

CREATE INDEX IF NOT EXISTS idx_bi_gaps_open ON bi_coverage_gaps (status, country, coverage_code);
CREATE INDEX IF NOT EXISTS idx_bi_gaps_app ON bi_coverage_gaps (application_id);
