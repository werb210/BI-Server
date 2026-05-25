-- Spec (Q1 answer): "We only ask for PnL, Balance sheet, three years of
-- accountant prepared financials, A/R, A/P. we will not ask for the rest
-- at our point in the process."
-- The catalog held founder_cv + financial_forecast which the UI never
-- collected; remove from active list and replace with annual_financials_3yr.

-- Deactivate the two we no longer ask for.
UPDATE bi_required_doc_catalog SET active = FALSE, updated_at = NOW()
 WHERE doc_type IN ('founder_cv', 'financial_forecast');

-- Insert the new 3yr annual financials entry.
INSERT INTO bi_required_doc_catalog (doc_type, display_label, description, if_startup, sort_order, active)
VALUES (
  'annual_financials_3yr',
  '3 Years Accountant-Prepared Annual Financials',
  'Accountant-prepared annual financial statements for the most recent 3 fiscal years. Upload one PDF per year.',
  FALSE,
  25,
  TRUE
)
ON CONFLICT (doc_type) DO UPDATE
  SET display_label = EXCLUDED.display_label,
      description = EXCLUDED.description,
      if_startup = EXCLUDED.if_startup,
      sort_order = EXCLUDED.sort_order,
      active = TRUE,
      updated_at = NOW();

-- Ensure the other 4 stay active in the right order.
UPDATE bi_required_doc_catalog
   SET active = TRUE, updated_at = NOW()
 WHERE doc_type IN ('profit_loss', 'balance_sheet', 'ar_aging', 'ap_aging');

-- Sort order: P&L 10, Balance Sheet 20, 3yr Financials 25, A/R 30, A/P 40
UPDATE bi_required_doc_catalog SET sort_order = 10 WHERE doc_type = 'profit_loss';
UPDATE bi_required_doc_catalog SET sort_order = 20 WHERE doc_type = 'balance_sheet';
UPDATE bi_required_doc_catalog SET sort_order = 25 WHERE doc_type = 'annual_financials_3yr';
UPDATE bi_required_doc_catalog SET sort_order = 30 WHERE doc_type = 'ar_aging';
UPDATE bi_required_doc_catalog SET sort_order = 40 WHERE doc_type = 'ap_aging';
