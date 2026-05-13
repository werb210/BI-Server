-- BI_SERVER_BLOCK_v251_OUTREACH_CRM_v1
-- Foundation tables for Andrew's outreach CRM. All ALTER/CREATE
-- statements are idempotent so this is safe to run repeatedly.
-- Status values are NOT enforced by a DB enum so we can add new
-- ones without a schema change; CHECK constraint is the contract.

ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS outreach_status TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS outreach_owner_id TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS outreach_updated_at TIMESTAMPTZ;

-- Allowed outreach_status values (PROJECT_PLAN row 8, LOCKED).
-- NULL = not yet triaged.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='bi_contacts' AND constraint_name='bi_contacts_outreach_status_check'
  ) THEN
    ALTER TABLE bi_contacts
      ADD CONSTRAINT bi_contacts_outreach_status_check
      CHECK (
        outreach_status IS NULL
        OR outreach_status IN (
          'cold','attempting','voicemail','engaged',
          'demo_booked','demo_completed','not_interested','lender'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bi_contacts_outreach_status
  ON bi_contacts(outreach_status)
  WHERE outreach_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bi_contacts_outreach_owner
  ON bi_contacts(outreach_owner_id)
  WHERE outreach_owner_id IS NOT NULL;

-- Activity timeline per contact. Free-form event_type so call,
-- demo, sms, status_change, note, etc. all share one table.
CREATE TABLE IF NOT EXISTS bi_contact_activity (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES bi_contacts(id) ON DELETE CASCADE,
  actor_id        TEXT,
  actor_name      TEXT,
  event_type      TEXT NOT NULL,
  outcome         TEXT,
  body            TEXT,
  meta            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_contact_activity_contact_created
  ON bi_contact_activity(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bi_contact_activity_event_type
  ON bi_contact_activity(event_type);

-- Staff profile (BF staff identified by staff_user_id from JWT).
-- bookings_url is the MS Bookings link Maya/the team uses when
-- sending demo invites. One row per staff user.
CREATE TABLE IF NOT EXISTS bi_staff_profile (
  staff_user_id   TEXT PRIMARY KEY,
  display_name    TEXT,
  bookings_url    TEXT,
  phone_e164      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
