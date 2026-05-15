-- BI_SERVER_BLOCK_v330_BI_APPLICATIONS_CONSTRAINT_FIX_v1
-- SHOW-STOPPER FIX. See block intent for full bug walkthrough.
-- This migration fixes three CHECK constraints on bi_applications
-- that were blocking 100% of real BI public-app and lender-app
-- submissions: status_check (rejected 'new_application'),
-- loan_purpose_check (rejected any free-text input), and
-- entity_type_check (defensive re-drop -- v258 intended to drop
-- but the constraint is still firing in production).
-- Idempotent: DROP IF EXISTS guards every change.

BEGIN;

-- Fix #1: widen status_check to include 'new_application' staging state.
ALTER TABLE bi_applications
  DROP CONSTRAINT IF EXISTS bi_applications_status_check;

ALTER TABLE bi_applications
  ADD CONSTRAINT bi_applications_status_check
  CHECK (status IN (
    'new_application',
    'created',
    'in_progress',
    'document_review',
    'ready_for_submission',
    'submitted',
    'under_review',
    'information_required',
    'approved',
    'declined',
    'policy_issued'
  ));

-- Fix #2: drop loan_purpose_check. Free-text intake field, not a pipeline
-- gate. UI-layer validation is the right place for this if needed later.
ALTER TABLE bi_applications
  DROP CONSTRAINT IF EXISTS bi_applications_loan_purpose_check;

-- Fix #3: drop entity_type_check (defensive re-drop -- v258 intended to
-- drop this but production log on 2026-05-14 still shows it firing).
-- Form sends display strings, code writes lifecycle hints, constraint
-- was blocking submits.
ALTER TABLE bi_applications
  DROP CONSTRAINT IF EXISTS bi_applications_entity_type_check;

COMMIT;
