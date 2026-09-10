-- BI_PGI_REQUIRED_FLAG_v1
ALTER TABLE bi_required_doc_catalog
  ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE bi_required_doc_catalog
   SET required = FALSE, updated_at = NOW()
 WHERE doc_type IN (
   'profit_loss','balance_sheet','ar_aging','ap_aging','founder_cv','financial_forecast'
 ) AND required IS DISTINCT FROM FALSE;
UPDATE bi_required_doc_catalog
   SET required = TRUE, updated_at = NOW()
 WHERE doc_type = 'loan_agreement'
   AND required IS DISTINCT FROM TRUE;
