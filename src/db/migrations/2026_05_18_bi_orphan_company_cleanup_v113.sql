-- Block 113 cleanup: convert company-shaped orphan contacts into company links.
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS converted_to_company_id UUID;
ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS phone TEXT;

DO $$
DECLARE
  orphan_count INT := 0;
  company_inserted_count INT := 0;
  linked_count INT := 0;
  remaining_count INT := 0;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM bi_contacts
  WHERE (first_name IS NULL OR first_name = '')
    AND (last_name IS NULL OR last_name = '')
    AND full_name IS NOT NULL
    AND converted_to_company_id IS NULL;

  RAISE NOTICE 'Block 113 orphan-company cleanup: candidate orphan contacts before=%', orphan_count;

  WITH orphans AS (
    SELECT id, full_name, email, phone_e164, company_id
    FROM bi_contacts
    WHERE (first_name IS NULL OR first_name = '')
      AND (last_name IS NULL OR last_name = '')
      AND full_name IS NOT NULL
      AND converted_to_company_id IS NULL
  ), inserted AS (
    INSERT INTO bi_companies (id, legal_name, operating_name, industry, email, phone, created_at)
    SELECT gen_random_uuid(), o.full_name, NULL, NULL, o.email, o.phone_e164, NOW()
    FROM orphans o
    WHERE NOT EXISTS (
      SELECT 1 FROM bi_companies c
      WHERE LOWER(c.legal_name) = LOWER(o.full_name)
         OR LOWER(COALESCE(c.operating_name, '')) = LOWER(o.full_name)
    )
    RETURNING id, legal_name
  )
  SELECT COUNT(*) INTO company_inserted_count FROM inserted;

  RAISE NOTICE 'Block 113 orphan-company cleanup: companies inserted=%', company_inserted_count;

  UPDATE bi_contacts c
  SET converted_to_company_id = (
    SELECT bc.id
    FROM bi_companies bc
    WHERE LOWER(bc.legal_name) = LOWER(c.full_name)
       OR LOWER(COALESCE(bc.operating_name, '')) = LOWER(c.full_name)
    LIMIT 1
  )
  WHERE (c.first_name IS NULL OR c.first_name = '')
    AND (c.last_name IS NULL OR c.last_name = '')
    AND c.full_name IS NOT NULL
    AND c.converted_to_company_id IS NULL;

  GET DIAGNOSTICS linked_count = ROW_COUNT;
  RAISE NOTICE 'Block 113 orphan-company cleanup: contacts linked=%', linked_count;

  SELECT COUNT(*) INTO remaining_count
  FROM bi_contacts
  WHERE (first_name IS NULL OR first_name = '')
    AND (last_name IS NULL OR last_name = '')
    AND full_name IS NOT NULL
    AND converted_to_company_id IS NULL;

  RAISE NOTICE 'Block 113 orphan-company cleanup: remaining orphan contacts after=%', remaining_count;
END $$;
