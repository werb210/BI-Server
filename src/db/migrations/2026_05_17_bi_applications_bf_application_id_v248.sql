-- BI_SERVER_BLOCK_v248_APPLICATIONS_FROM_BF_v1
-- Reverse-link from a BI application back to the originating BF
-- application so staff can audit the handoff and BF can avoid creating
-- duplicate BI rows on resubmit. Idempotent ADD.
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS bf_application_id TEXT;
CREATE INDEX IF NOT EXISTS idx_bi_applications_bf_application_id
  ON bi_applications(bf_application_id)
  WHERE bf_application_id IS NOT NULL;
-- BI_SERVER_BLOCK_v248_APPLICATIONS_FROM_BF_v1
-- NAICS best-effort flag: when BF can't confidently map their loose
-- industry string to a 6-digit NAICS code, BF passes naics_confidence=false
-- and BI surfaces the field as required on the completion form.
ALTER TABLE bi_applications ADD COLUMN IF NOT EXISTS naics_confidence BOOLEAN;
