-- 2026_05_27_carrier_doc_catalog_align_v384.sql
-- v398 FIX of v384.
-- Original bug: rows were inserted into bi_required_doc_catalog without
-- display_label, which is NOT NULL (see 20260503_pgi_doc_policy_v61b_seed.sql),
-- raising 23502 and aborting this migration on every boot. Because this is the
-- first un-applied migration, the abort also blocked every migration after it.
-- This version supplies display_label + description for every row and is fully
-- idempotent (re-running only refreshes the label/description/flags).
--
-- The 7 doc types mirror the PGI/Purbeck partner schema:
--   loan_agreement      -> REQUIRED for all Canadian submissions
--   profit_loss, balance_sheet, ar_aging, ap_aging, founder_cv,
--   financial_forecast  -> optional financial docs included in submission
-- The table is created by an earlier migration; we do not redefine it here.

INSERT INTO bi_required_doc_catalog
  (doc_type, display_label, description, if_startup, sort_order, active)
VALUES
  ('loan_agreement',     'Loan Agreement / Term Sheet', 'Lender agreement or term sheet. Required for Canadian (Purbeck) submissions.', FALSE, 10, TRUE),
  ('profit_loss',        'Profit & Loss Statement',     'Optional financial document included in the Purbeck submission.',              FALSE, 20, TRUE),
  ('balance_sheet',      'Balance Sheet',               'Optional financial document included in the Purbeck submission.',              FALSE, 30, TRUE),
  ('ar_aging',           'Accounts Receivable Aging',   'Optional financial document included in the Purbeck submission.',              FALSE, 40, TRUE),
  ('ap_aging',           'Accounts Payable Aging',      'Optional financial document included in the Purbeck submission.',              FALSE, 50, TRUE),
  ('founder_cv',         'Founder CV / Resume',         'Optional supporting document included in the Purbeck submission.',             FALSE, 60, TRUE),
  ('financial_forecast', 'Financial Forecast',          'Optional financial document included in the Purbeck submission.',              FALSE, 70, TRUE)
ON CONFLICT (doc_type) DO UPDATE SET
  display_label = EXCLUDED.display_label,
  description   = EXCLUDED.description,
  if_startup    = EXCLUDED.if_startup,
  sort_order    = EXCLUDED.sort_order,
  active        = EXCLUDED.active,
  updated_at    = NOW();
