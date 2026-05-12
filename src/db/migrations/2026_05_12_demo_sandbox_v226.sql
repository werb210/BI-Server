-- BI_SERVER_BLOCK_v226_DEMO_SANDBOX_v1
ALTER TABLE bi_lenders     ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_bi_lenders_is_demo      ON bi_lenders(is_demo);
CREATE INDEX IF NOT EXISTS idx_bi_applications_is_demo ON bi_applications(is_demo);

-- contact_phone_e164 needs a unique constraint for the ON CONFLICT above to
-- resolve. Use a partial unique index to allow legacy NULLs to coexist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_lenders_contact_phone_e164
  ON bi_lenders(contact_phone_e164) WHERE contact_phone_e164 IS NOT NULL;

-- Provision the dedicated demo lender. ON CONFLICT guard makes this safe to
-- rerun across deploys. The phone is a non-deliverable +1-587-555-0000 so
-- nothing ever tries to OTP-text it; the /demo-session endpoint bypasses OTP.
INSERT INTO bi_lenders (
  company_name, contact_phone_e164, contact_full_name, contact_email,
  country, is_active, is_demo
) VALUES (
  'Boreal Demo Lender', '+15875550000', 'Demo Account', 'demo@boreal.financial',
  'CA', TRUE, TRUE
)
ON CONFLICT (contact_phone_e164) DO UPDATE
  SET is_demo = TRUE, is_active = TRUE;
