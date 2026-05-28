-- 2026_05_28_deactivate_stale_doc_catalog_v403.sql
-- The v384/v398 catalog re-seed upserts the 7 canonical PGI/Purbeck doc types
-- but never deactivates rows seeded by earlier migrations (financial_statements,
-- annual_y1/y2/y3, etc.), which linger active=TRUE and still surface in the
-- staff Documents/Requirements tab. Deactivate anything outside the canonical 7.
-- Fully idempotent.
UPDATE bi_required_doc_catalog
   SET active = FALSE,
       updated_at = NOW()
 WHERE active = TRUE
   AND doc_type NOT IN (
     'loan_agreement','profit_loss','balance_sheet',
     'ar_aging','ap_aging','founder_cv','financial_forecast'
   );
