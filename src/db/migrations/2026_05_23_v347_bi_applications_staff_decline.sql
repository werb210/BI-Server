-- BI_SERVER_BLOCK_v347_STAFF_DECLINE_v1 — track staff-initiated declines on bi_applications.
-- The `stage` column already supports the 'declined' value (set by carrier and
-- by staff alike); these new columns let us distinguish a STAFF decline from a
-- CARRIER decline and store the staff member's reason.

ALTER TABLE IF EXISTS bi_applications
  ADD COLUMN IF NOT EXISTS staff_declined_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS staff_declined_by  UUID,
  ADD COLUMN IF NOT EXISTS staff_decline_reason TEXT;

CREATE INDEX IF NOT EXISTS bi_applications_staff_declined_at_idx
  ON bi_applications(staff_declined_at)
  WHERE staff_declined_at IS NOT NULL;
