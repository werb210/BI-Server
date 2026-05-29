-- BI_SERVER_BLOCK_v409_OUTREACH_PIPELINE_v1
-- Additive-only. Kanban pipeline for Andrew's outreach.
-- Stage model (LOCKED): new, contacted, engaged, demo_booked,
-- demo_completed, onboarding, active, not_interested.
-- Legacy values (cold, attempting, voicemail, lender) remain VALID
-- so existing rows never violate the constraint; app maps them.

-- 1) Segment: lender vs broker (distinct from Apollo icp_segment).
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS outreach_segment TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='bi_contacts'
       AND constraint_name='bi_contacts_outreach_segment_check'
  ) THEN
    ALTER TABLE bi_contacts
      ADD CONSTRAINT bi_contacts_outreach_segment_check
      CHECK (outreach_segment IS NULL OR outreach_segment IN ('lender','broker'));
  END IF;
END $$;

-- 2) Extend the status CHECK to the 7 stages + archive, additively.
--    Drop the old constraint only to re-add a SUPERSET (no data loss:
--    every previously-allowed value is still allowed).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='bi_contacts'
       AND constraint_name='bi_contacts_outreach_status_check'
  ) THEN
    ALTER TABLE bi_contacts DROP CONSTRAINT bi_contacts_outreach_status_check;
  END IF;

  ALTER TABLE bi_contacts
    ADD CONSTRAINT bi_contacts_outreach_status_check
    CHECK (
      outreach_status IS NULL
      OR outreach_status IN (
        -- new pipeline stages
        'new','contacted','engaged','demo_booked','demo_completed',
        'onboarding','active','not_interested',
        -- legacy values retained so existing rows stay valid
        'cold','attempting','voicemail','lender'
      )
    );
END $$;

-- 3) Lender back-link already exists as promoted_lender_id (UUID).
--    Ensure an index for card->lender navigation / double-onboard guard.
CREATE INDEX IF NOT EXISTS idx_bi_contacts_promoted_lender
  ON bi_contacts(promoted_lender_id)
  WHERE promoted_lender_id IS NOT NULL;

-- 4) Index segment for board filtering.
CREATE INDEX IF NOT EXISTS idx_bi_contacts_outreach_segment
  ON bi_contacts(outreach_segment)
  WHERE outreach_segment IS NOT NULL;
