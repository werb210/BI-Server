-- BI_SERVER_BLOCK_v257_STAFF_DIRECTORY_v1
-- Defensive backstop for bi_staff_profile. v251 introduced this table
-- alongside the outreach CRM work; this migration is a no-op when v251
-- has already run, but fills in any missing columns. It also adds the
-- indexes the directory query relies on for ordering and search.

CREATE TABLE IF NOT EXISTS bi_staff_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id UUID NOT NULL,
  full_name TEXT,
  email TEXT,
  role TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- In case v251 created the table with a subset of columns, top up
-- whatever's missing. Each ADD COLUMN IF NOT EXISTS is a no-op
-- when the column already exists.
ALTER TABLE bi_staff_profile ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE bi_staff_profile ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE bi_staff_profile ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE bi_staff_profile ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE bi_staff_profile ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE bi_staff_profile ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Unique constraint on staff_user_id is critical for the upsert
-- (PUT /me uses ON CONFLICT). Add it if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bi_staff_profile_staff_user_id_key'
  ) THEN
    ALTER TABLE bi_staff_profile
      ADD CONSTRAINT bi_staff_profile_staff_user_id_key UNIQUE (staff_user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bi_staff_profile_active
  ON bi_staff_profile(is_active);
CREATE INDEX IF NOT EXISTS idx_bi_staff_profile_full_name
  ON bi_staff_profile(full_name);
