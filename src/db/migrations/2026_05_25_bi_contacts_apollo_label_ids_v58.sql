-- BI_SERVER_BLOCK_58_APOLLO_LIST_IMPORT_v1
-- Track which Apollo saved list(s) each contact was imported from. Multi-
-- valued because a contact can appear in several lists in Apollo. Idempotent.
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS apollo_label_ids TEXT[] DEFAULT ARRAY[]::TEXT[];
CREATE INDEX IF NOT EXISTS bi_contacts_apollo_label_ids_gin_idx ON bi_contacts USING GIN (apollo_label_ids);
