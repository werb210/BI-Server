-- BI_SERVER_BLOCK_v842_APOLLO_SUPPRESSION_AND_NAME
ALTER TABLE bi_suppressions ADD COLUMN IF NOT EXISTS display_name TEXT;

UPDATE bi_suppressions s
   SET display_name = c.full_name
  FROM bi_contacts c
 WHERE s.contact_id = c.id
   AND s.display_name IS NULL
   AND c.full_name IS NOT NULL;
