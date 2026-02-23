CREATE TABLE IF NOT EXISTS bi_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES bi_applications(id) ON DELETE CASCADE,
  annual_premium NUMERIC NOT NULL,
  commission_rate NUMERIC DEFAULT 0.10,
  commission_amount NUMERIC NOT NULL,
  year INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
