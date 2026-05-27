-- BI_SERVER_BLOCK_v371_DOC_UNIQUE_v1
-- Fixed by BI_SERVER_BLOCK_v377_LAUNCH_SUBMIT_UNBLOCK_v1.
--
-- Original v371 referenced two columns that don't exist on bi_documents:
--   - uploaded_at  (master schema has `created_at` — see
--                   20260222_00_bi_master_schema.sql:265-277)
--   - purge_reason (never added; not worth a separate column for v1)
-- Both caused the migration to fail on every boot, leaving the unique
-- index uncreated. This rewrite uses created_at for the dedup ordering
-- and drops the purge_reason write entirely (purged_at NOW() is enough
-- audit trail for "this row was deduped").
--
-- Idempotent: re-running on a DB where the index already exists is a
-- no-op. The dedup UPDATE is also safe on a clean schema (zero rows
-- match if there are no duplicates).

-- Mark older duplicates of the same (application_id, doc_type) as purged,
-- keeping the most recently created active row. created_at + id DESC gives
-- a deterministic winner even when timestamps collide.
UPDATE bi_documents d
   SET purged_at = NOW()
  FROM (
    SELECT id
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY application_id, doc_type
                 ORDER BY created_at DESC, id DESC
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
