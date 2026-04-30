-- BI_PGI_ALIGNMENT_v56 — full PGI alignment: lender admin fields, referrer
-- changes, contact lifecycle, staff notify, source_type branching.
-- All idempotent.

ALTER TABLE bi_lenders ADD COLUMN IF NOT EXISTS website_url        TEXT;
ALTER TABLE bi_lenders ADD COLUMN IF NOT EXISTS address_line1      TEXT;
ALTER TABLE bi_lenders ADD COLUMN IF NOT EXISTS city               TEXT;
ALTER TABLE bi_lenders ADD COLUMN IF NOT EXISTS province           TEXT;
ALTER TABLE bi_lenders ADD COLUMN IF NOT EXISTS postal_code        TEXT;
ALTER TABLE bi_lenders ADD COLUMN IF NOT EXISTS country            TEXT NOT NULL DEFAULT 'CA';
ALTER TABLE bi_lenders ADD COLUMN IF NOT EXISTS contact_full_name  TEXT;
ALTER TABLE bi_lenders ADD COLUMN IF NOT EXISTS contact_email      TEXT;
ALTER TABLE bi_lenders ADD COLUMN IF NOT EXISTS contact_phone_e164 TEXT;
ALTER TABLE bi_lenders ADD COLUMN IF NOT EXISTS is_active          BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE bi_lenders ADD COLUMN IF NOT EXISTS created_by_user_id UUID;
CREATE INDEX IF NOT EXISTS idx_bi_lenders_active ON bi_lenders(is_active);

CREATE TABLE IF NOT EXISTS bi_lender_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_id     UUID NOT NULL REFERENCES bi_lenders(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  email         TEXT,
  phone_e164    TEXT,
  role          TEXT,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_lender_contacts_lender ON bi_lender_contacts(lender_id);

ALTER TABLE bi_referrers ALTER COLUMN company_name DROP NOT NULL;
ALTER TABLE bi_referrers ADD COLUMN IF NOT EXISTS etransfer_email TEXT;

ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT NOT NULL DEFAULT 'lead';
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS source_first    TEXT;
CREATE INDEX IF NOT EXISTS idx_bi_contacts_lifecycle ON bi_contacts(lifecycle_stage);

ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'public';
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS docs_review_required BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_bi_applications_source ON bi_applications(source_type);

CREATE TABLE IF NOT EXISTS bi_staff_notify_recipients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID,
  full_name     TEXT NOT NULL,
  phone_e164    TEXT NOT NULL,
  notify_contact_form BOOLEAN NOT NULL DEFAULT TRUE,
  notify_new_application BOOLEAN NOT NULL DEFAULT TRUE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_staff_notify_active ON bi_staff_notify_recipients(is_active);
