-- BI_SERVER_BLOCK_v243_LENDER_USERS_v1
ALTER TABLE bi_lender_contacts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE bi_lender_contacts ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE bi_lender_contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_lender_contacts_phone_active
  ON bi_lender_contacts(phone_e164) WHERE is_active = TRUE AND phone_e164 IS NOT NULL;
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS created_by_lender_user_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name='bi_applications' AND column_name='created_by_lender_user_id'
      AND constraint_name='fk_bi_apps_lender_user'
  ) THEN
    ALTER TABLE bi_applications
      ADD CONSTRAINT fk_bi_apps_lender_user
      FOREIGN KEY (created_by_lender_user_id) REFERENCES bi_lender_contacts(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bi_apps_lender_user ON bi_applications(created_by_lender_user_id) WHERE created_by_lender_user_id IS NOT NULL;
INSERT INTO bi_lender_contacts (lender_id, full_name, email, phone_e164, role, is_primary, is_active)
SELECT l.id,
       COALESCE(NULLIF(TRIM(l.contact_full_name), ''), '(primary)'),
       NULLIF(LOWER(TRIM(l.contact_email)), ''),
       NULLIF(TRIM(l.contact_phone_e164), ''),
       'primary',
       TRUE,
       TRUE
FROM bi_lenders l
WHERE l.contact_phone_e164 IS NOT NULL
  AND NULLIF(TRIM(l.contact_phone_e164), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM bi_lender_contacts c
     WHERE c.lender_id = l.id
       AND c.phone_e164 = NULLIF(TRIM(l.contact_phone_e164), '')
  );
