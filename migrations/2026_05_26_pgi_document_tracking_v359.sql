-- BI_SERVER_BLOCK_v359_PGI_DOC_FORWARDING_v1
-- Track which bi_documents have been forwarded to PGI and what their
-- carrier-side document_id is. Both columns nullable + idempotent so
-- the migration is safe on re-deploy.

ALTER TABLE bi_documents
  ADD COLUMN IF NOT EXISTS pgi_document_id          TEXT,
  ADD COLUMN IF NOT EXISTS forwarded_to_carrier_at  TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_bi_documents_pgi_pending
  ON bi_documents (application_id)
  WHERE pgi_document_id IS NULL AND purged_at IS NULL;
