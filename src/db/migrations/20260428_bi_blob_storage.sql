-- BI_HARDENING_v44 — bi_documents: store blob metadata alongside legacy storage_key.
-- Idempotent. Old rows keep their storage_key (interpreted as local path); new rows
-- write blob_name + blob_url + sha256_hash.
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS blob_name TEXT;
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS blob_url  TEXT;
ALTER TABLE bi_documents ADD COLUMN IF NOT EXISTS sha256_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_bi_documents_blob_name ON bi_documents(blob_name);
