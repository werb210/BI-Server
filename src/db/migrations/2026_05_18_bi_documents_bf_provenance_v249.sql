-- BI_SERVER_BLOCK_v249_DOCS_FROM_BF_v1
-- Track which BI documents originated from a BF mirror, so staff
-- can filter "originally uploaded on the BF loan application" vs.
-- "uploaded directly to the PGI flow". Idempotent ADD.
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS bf_document_id TEXT;
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS bf_application_id TEXT;
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS source TEXT;
CREATE INDEX IF NOT EXISTS idx_bi_documents_bf_document_id
  ON bi_documents(bf_document_id)
  WHERE bf_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bi_documents_bf_application_id
  ON bi_documents(bf_application_id)
  WHERE bf_application_id IS NOT NULL;
