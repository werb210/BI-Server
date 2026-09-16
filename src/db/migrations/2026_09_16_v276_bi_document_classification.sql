-- BI_SERVER_DOC_CLASSIFICATION_v276
-- What BI-Server's OCR text says a document is, so staff can spot a document
-- uploaded into the wrong slot. Advisory only: nothing is moved automatically.
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS detected_type TEXT;
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS detected_confidence NUMERIC(4,2);
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS detected_mismatch BOOLEAN;
