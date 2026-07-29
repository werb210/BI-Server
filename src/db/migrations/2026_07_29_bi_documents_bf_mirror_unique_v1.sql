-- BI_DOCUMENTS_BF_MIRROR_UNIQUE_v1
-- Remove retry-created duplicates before installing the conflict arbiter. Keep
-- the most recently created row (and use id as a deterministic tie breaker).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY application_id, bf_document_id
           ORDER BY created_at DESC NULLS LAST, id DESC
         ) AS duplicate_number
  FROM bi_documents
  WHERE bf_document_id IS NOT NULL
)
DELETE FROM bi_documents d
USING ranked r
WHERE d.id = r.id
  AND r.duplicate_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS bi_documents_application_bf_document_unique_v1
  ON bi_documents (application_id, bf_document_id)
  WHERE bf_document_id IS NOT NULL;
