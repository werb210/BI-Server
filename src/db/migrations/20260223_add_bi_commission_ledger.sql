CREATE TABLE IF NOT EXISTS bi_commission_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES bi_applications(id),
  policy_year INTEGER,
  insured_amount NUMERIC,
  annual_premium NUMERIC,
  commission NUMERIC,
  renewal_date DATE,
  paid BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bi_commission_ledger_app_year
  ON bi_commission_ledger(application_id, policy_year);
