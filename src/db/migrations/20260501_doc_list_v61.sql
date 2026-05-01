-- BI_DOC_LIST_v61 — staff verify "most recent" by checking period_end.
-- Idempotent.
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS period_end DATE;
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS doc_slot   TEXT;
CREATE INDEX IF NOT EXISTS idx_bi_documents_doc_slot ON bi_documents(application_id, doc_slot);
COMMENT ON COLUMN bi_documents.period_end IS 'Applicant-declared period-end date for the document; staff verify on Accept/Reject.';
COMMENT ON COLUMN bi_documents.doc_slot   IS 'Canonical slot from BI_DOC_LIST_v61 (pl_12mo, balance_sheet, ar_aging, ap_aging, founder_cv, forecast, gov_id_primary, gov_id_secondary).';
