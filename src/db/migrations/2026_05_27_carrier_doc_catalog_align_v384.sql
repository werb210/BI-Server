-- BI_SERVER_BLOCK_v384_CARRIER_DOC_CATALOG_ALIGN_v1
-- Carrier is the source of truth (per operator ruling 2026-05-27).
-- Canonical 7 slots = same set used by:
--   biPublicApplicationRoutes.ts ALLOWED_PUBLIC_DOC_TYPES_v368
--   bi-website src/lib/biDocumentRequirements.ts BI_DOC_REQUIREMENTS
-- Reverses 2026_05_24_bi_catalog_five_items.sql which deactivated founder_cv
-- + financial_forecast and added the non-carrier 'annual_financials_3yr'.
--
-- 5 always-required: loan_agreement, profit_loss, balance_sheet, ar_aging, ap_aging
-- 2 startup-only:    founder_cv, financial_forecast
-- Sort: loan_agreement=5, profit_loss=10, balance_sheet=20, ar_aging=30,
--       ap_aging=40, founder_cv=50, financial_forecast=60

INSERT INTO bi_required_doc_catalog
  (doc_type, display_label, description, if_startup, sort_order, active)
VALUES
  ('loan_agreement', 'Lender Agreement / Term Sheet',
   'Upload the lender''s agreement or term sheet for the loan being insured.',
   FALSE, 5, TRUE),
  ('founder_cv', 'Founder CV(s)',
   'Required for businesses under 3 years old. Upload one PDF combining all founders.',
   TRUE, 50, TRUE),
  ('financial_forecast', 'Financial Forecast',
   'Required for businesses under 3 years old. 12-24 month projections.',
   TRUE, 60, TRUE)
ON CONFLICT (doc_type) DO UPDATE
  SET display_label = EXCLUDED.display_label,
      description   = EXCLUDED.description,
      if_startup    = EXCLUDED.if_startup,
      sort_order    = EXCLUDED.sort_order,
      active        = TRUE,
      updated_at    = NOW();

-- Deactivate the non-carrier slot the v24 migration introduced.
UPDATE bi_required_doc_catalog
   SET active = FALSE, updated_at = NOW()
 WHERE doc_type = 'annual_financials_3yr';

-- Re-anchor sort_order on the 4 always-required carrier slots in case prior
-- migrations left them out of order.
UPDATE bi_required_doc_catalog SET sort_order = 10, active = TRUE, updated_at = NOW()
 WHERE doc_type = 'profit_loss';
UPDATE bi_required_doc_catalog SET sort_order = 20, active = TRUE, updated_at = NOW()
 WHERE doc_type = 'balance_sheet';
UPDATE bi_required_doc_catalog SET sort_order = 30, active = TRUE, updated_at = NOW()
 WHERE doc_type = 'ar_aging';
UPDATE bi_required_doc_catalog SET sort_order = 40, active = TRUE, updated_at = NOW()
 WHERE doc_type = 'ap_aging';
