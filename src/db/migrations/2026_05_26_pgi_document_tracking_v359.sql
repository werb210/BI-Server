-- BI_SERVER_BLOCK_v359_PGI_DOC_FORWARDING_v1
-- BI_SERVER_BLOCK_v363_RELOCATE_MIGRATIONS_v1 — relocated from /migrations/
-- to /src/db/migrations/ per guardrails workflow + runMigrations boot path.
-- Tracks which bi_documents have been forwarded to PGI and what their
-- carrier-side document_id is. Both columns nullable + idempotent.

ALTER TABLE bi_documents
  ADD COLUMN IF NOT EXISTS pgi_document_id          TEXT,
  ADD COLUMN IF NOT EXISTS forwarded_to_carrier_at  TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_bi_documents_pgi_pending
  ON bi_documents (application_id)
  WHERE pgi_document_id IS NULL AND purged_at IS NULL;
