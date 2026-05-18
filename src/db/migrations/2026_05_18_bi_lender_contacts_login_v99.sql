CREATE TABLE IF NOT EXISTS bi_lender_login_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_id UUID NOT NULL REFERENCES bi_lenders(id) ON DELETE CASCADE,
  email TEXT,
  phone_e164 TEXT,
  full_name TEXT,
  role TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_bi_lender_login_contacts_lender ON bi_lender_login_contacts(lender_id);
CREATE INDEX IF NOT EXISTS idx_bi_lender_login_contacts_email ON bi_lender_login_contacts(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_bi_lender_login_contacts_phone ON bi_lender_login_contacts(phone_e164);

-- Backfill existing primary contact into the new table so current logins keep working
INSERT INTO bi_lender_login_contacts (lender_id, email, phone_e164, full_name)
SELECT id, contact_email, contact_phone_e164, contact_name FROM bi_lenders
WHERE (contact_email IS NOT NULL OR contact_phone_e164 IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM bi_lender_login_contacts c WHERE c.lender_id = bi_lenders.id
  );
