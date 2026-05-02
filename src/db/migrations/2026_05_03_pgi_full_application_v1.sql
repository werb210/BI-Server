-- BI_BLOCK_PGI_FULL_APP_v1 — adds the remaining columns surfaced by
-- the PGI public application UX (45 questions across 6 sections).
-- Idempotent: every column add uses IF NOT EXISTS.

ALTER TABLE bi_applications
  -- 8-char human-friendly id, separate from internal UUID id.
  ADD COLUMN IF NOT EXISTS public_id TEXT,
  -- Policy holder
  ADD COLUMN IF NOT EXISTS guarantor_dob          DATE,
  ADD COLUMN IF NOT EXISTS guarantor_address      TEXT,
  ADD COLUMN IF NOT EXISTS guarantor_phone        TEXT,
  -- Business information
  ADD COLUMN IF NOT EXISTS business_address       TEXT,
  ADD COLUMN IF NOT EXISTS business_website       TEXT,
  ADD COLUMN IF NOT EXISTS entity_type            TEXT,
  ADD COLUMN IF NOT EXISTS business_number        TEXT,
  -- Loan & guarantee details
  ADD COLUMN IF NOT EXISTS csbfp_backed           BOOLEAN,
  ADD COLUMN IF NOT EXISTS loan_has_guaranteed_cap BOOLEAN,
  ADD COLUMN IF NOT EXISTS loan_funding_date      DATE,
  ADD COLUMN IF NOT EXISTS loan_purpose           TEXT,
  ADD COLUMN IF NOT EXISTS personally_guaranteeing BOOLEAN,
  ADD COLUMN IF NOT EXISTS has_other_guarantors   BOOLEAN,
  ADD COLUMN IF NOT EXISTS policy_start_date      DATE,
  -- Risk & compliance
  ADD COLUMN IF NOT EXISTS payables_threatening   BOOLEAN,
  ADD COLUMN IF NOT EXISTS upcoming_adverse_events BOOLEAN,
  ADD COLUMN IF NOT EXISTS personal_investigations BOOLEAN,
  ADD COLUMN IF NOT EXISTS business_investigations BOOLEAN,
  ADD COLUMN IF NOT EXISTS property_insurance_in_force BOOLEAN,
  ADD COLUMN IF NOT EXISTS personal_judgments     BOOLEAN,
  ADD COLUMN IF NOT EXISTS business_judgments     BOOLEAN,
  -- Consents (7) — store as one jsonb to keep schema flat
  ADD COLUMN IF NOT EXISTS consents               JSONB,
  -- Score lifecycle
  ADD COLUMN IF NOT EXISTS score_stale            BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS bi_applications_public_id_idx
  ON bi_applications(public_id);

ALTER TABLE bi_applications
  ADD CONSTRAINT bi_applications_loan_purpose_check
  CHECK (loan_purpose IS NULL OR loan_purpose IN (
    'working_capital','equipment','expansion','acquisition',
    'real_estate','refinance','other'
  ));

ALTER TABLE bi_applications
  ADD CONSTRAINT bi_applications_entity_type_check
  CHECK (entity_type IS NULL OR entity_type IN (
    'sole_proprietorship','partnership','corporation','llc','other'
  ));

-- Backfill public_id for existing rows (safe no-op if table empty)
DO $$
DECLARE r RECORD; new_id TEXT;
DECLARE chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
DECLARE i INT;
BEGIN
  FOR r IN SELECT id FROM bi_applications WHERE public_id IS NULL LOOP
    new_id := '';
    FOR i IN 1..8 LOOP
      new_id := new_id || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    END LOOP;
    UPDATE bi_applications SET public_id = new_id WHERE id = r.id;
  END LOOP;
END$$;

DO $$ BEGIN RAISE NOTICE 'BI_BLOCK_PGI_FULL_APP_v1 applied'; END$$;
