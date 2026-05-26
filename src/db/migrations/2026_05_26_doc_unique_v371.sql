-- BI_SERVER_BLOCK_v371_DOC_UNIQUE_v1
-- Deduplicate any historical multi-upload rows BEFORE adding the constraint.
-- Keeps the most recent (highest uploaded_at) row per (application_id, doc_type)
-- where the doc isn't purged. Older duplicates get marked purged so the
-- unique index can be added cleanly.

UPDATE bi_documents d
   SET purged_at = NOW(),
       purge_reason = COALESCE(purge_reason, 'v371_dedup_superseded')
  FROM (
    SELECT id
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY application_id, doc_type
                 ORDER BY uploaded_at DESC, id DESC
               ) AS rn
          FROM bi_documents
         WHERE purged_at IS NULL
      ) ranked
     WHERE rn > 1
  ) dupes
 WHERE d.id = dupes.id;

-- Partial unique index: only one ACTIVE doc per (application_id, doc_type).
-- Purged rows excluded so historical superseded uploads stay queryable.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bi_documents_app_doctype_unique
  ON bi_documents (application_id, doc_type)
  WHERE purged_at IS NULL;
