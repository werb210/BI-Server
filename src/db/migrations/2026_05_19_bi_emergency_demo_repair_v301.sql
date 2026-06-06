-- v301: Emergency demo repair — patches forward what v108/v110/v113 left missing.
-- Idempotent. Safe to re-run.

BEGIN;

-- (1) bi_contacts.converted_to_company_id — v113 was supposed to add this.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bi_contacts' AND column_name = 'converted_to_company_id'
  ) THEN
    ALTER TABLE bi_contacts
      ADD COLUMN converted_to_company_id UUID NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bi_contacts_converted_to_company_id
  ON bi_contacts (converted_to_company_id)
  WHERE converted_to_company_id IS NOT NULL;

-- (2) bi_user_send_quotas — v110 was supposed to create this.
-- Minimal shape: sequenceSendWorker.js SELECTs from it; empty table → no rows → no errors.
CREATE TABLE IF NOT EXISTS bi_user_send_quotas (
  user_id          UUID PRIMARY KEY,
  daily_limit      INTEGER NOT NULL DEFAULT 0,
  sent_today       INTEGER NOT NULL DEFAULT 0,
  window_start_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Fresh-replay guard: table may pre-exist (v110) without these columns.
ALTER TABLE bi_user_send_quotas ADD COLUMN IF NOT EXISTS daily_limit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bi_user_send_quotas ADD COLUMN IF NOT EXISTS sent_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bi_user_send_quotas ADD COLUMN IF NOT EXISTS window_start_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE bi_user_send_quotas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_bi_user_send_quotas_window
  ON bi_user_send_quotas (window_start_at);

COMMIT;
