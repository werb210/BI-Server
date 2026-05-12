-- BI_SERVER_BLOCK_v226_DEMO_SANDBOX_v1
-- BI_SERVER_BLOCK_v227_APPLICATION_CODE_AND_DEMO_FIXUP_v1 — rewritten to
-- avoid ON CONFLICT against a partial unique index (Postgres 42P10).

ALTER TABLE bi_lenders     ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_bi_lenders_is_demo      ON bi_lenders(is_demo);
CREATE INDEX IF NOT EXISTS idx_bi_applications_is_demo ON bi_applications(is_demo);

-- Provision the dedicated demo lender. INSERT WHERE NOT EXISTS so no unique
-- constraint on contact_phone_e164 is required.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bi_lenders WHERE contact_phone_e164 = '+15875550000') THEN
    INSERT INTO bi_lenders (
      company_name, contact_phone_e164, contact_full_name, contact_email,
      country, is_active, is_demo
    ) VALUES (
      'Boreal Demo Lender', '+15875550000', 'Demo Account', 'demo@boreal.financial',
      'CA', TRUE, TRUE
    );
  ELSE
    UPDATE bi_lenders
       SET is_demo = TRUE, is_active = TRUE
     WHERE contact_phone_e164 = '+15875550000';
  END IF;
END $$;
