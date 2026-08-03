-- BI_SERVER_CONTACT_ACTIVITY_RECONCILE_v1
-- Reconcile the two historical bi_contact_activity definitions without dropping data.
ALTER TABLE bi_contact_activity ADD COLUMN IF NOT EXISTS actor_id    TEXT;
ALTER TABLE bi_contact_activity ADD COLUMN IF NOT EXISTS actor_name  TEXT;
ALTER TABLE bi_contact_activity ADD COLUMN IF NOT EXISTS event_type  TEXT;
ALTER TABLE bi_contact_activity ADD COLUMN IF NOT EXISTS outcome     TEXT;
ALTER TABLE bi_contact_activity ADD COLUMN IF NOT EXISTS body        TEXT;
ALTER TABLE bi_contact_activity ADD COLUMN IF NOT EXISTS meta        JSONB;
ALTER TABLE bi_contact_activity ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE bi_contact_activity ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- A fresh database receives v108's required `kind`; preserve it, then relax it
-- so current outreach writers can insert their free-form event_type values.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'bi_contact_activity'
       AND column_name = 'kind'
  ) THEN
    UPDATE bi_contact_activity SET event_type = kind
     WHERE event_type IS NULL AND kind IS NOT NULL;
    ALTER TABLE bi_contact_activity ALTER COLUMN kind DROP NOT NULL;
  END IF;
END $$;

DO $$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'bi_contact_activity'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE bi_contact_activity DROP CONSTRAINT %I', target.conname);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_bi_contact_activity_contact_created
  ON bi_contact_activity (contact_id, created_at DESC);
