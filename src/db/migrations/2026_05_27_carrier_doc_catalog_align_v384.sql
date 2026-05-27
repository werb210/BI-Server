-- BI_SERVER_BLOCK_v384
-- Align required document catalog to carrier's seven slots.
BEGIN;

CREATE TABLE IF NOT EXISTS bi_required_doc_catalog (
  doc_type text PRIMARY KEY,
  active boolean NOT NULL DEFAULT TRUE,
  if_startup boolean NOT NULL DEFAULT FALSE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

INSERT INTO bi_required_doc_catalog (doc_type, active, if_startup, sort_order)
VALUES
  ('loan_agreement', TRUE, FALSE, 10),
  ('profit_loss', TRUE, FALSE, 20),
  ('balance_sheet', TRUE, FALSE, 30),
  ('ar_aging', TRUE, FALSE, 40),
  ('ap_aging', TRUE, FALSE, 50),
  ('founder_cv', TRUE, TRUE, 60),
  ('financial_forecast', TRUE, TRUE, 70)
ON CONFLICT (doc_type) DO UPDATE
SET active = EXCLUDED.active,
    if_startup = EXCLUDED.if_startup,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

UPDATE bi_required_doc_catalog
SET active = FALSE, updated_at = NOW()
WHERE doc_type NOT IN ('loan_agreement','profit_loss','balance_sheet','ar_aging','ap_aging','founder_cv','financial_forecast');

COMMIT;
