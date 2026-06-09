-- BI_SERVER_BLOCK_v812 — two fixes:
-- (1) PATCH /crm/contacts/:id always sets updated_at, but bi_contacts never had that column
--     (only outreach_updated_at + created_at), so every contact save 500'd as patch_failed.
-- (2) Tags were stored in mixed case (lender/Lender, lawyer/Lawyer), producing duplicate
--     View-by chips. Lowercase + de-dupe existing tags; all writes are lowercased going forward.
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE bi_contacts AS c
   SET tags = sub.t
  FROM (
    SELECT id,
           (SELECT array_agg(DISTINCT lower(x) ORDER BY lower(x)) FROM unnest(tags) AS x) AS t
      FROM bi_contacts
     WHERE cardinality(COALESCE(tags, '{}'::text[])) > 0
  ) AS sub
 WHERE c.id = sub.id
   AND c.tags IS DISTINCT FROM sub.t;
