-- BI_SERVER_BLOCK_v799_OUTREACH_IMPORT_AND_MASS_DELETE
-- Bulk CRM delete writes durable suppression rows with reason='deleted_from_crm'.
-- Keep this idempotent because suppression tables have existed with multiple shapes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'bi_suppressions'
  ) THEN
    ALTER TABLE bi_suppressions DROP CONSTRAINT IF EXISTS bi_suppressions_reason_check;
    ALTER TABLE bi_suppressions
      ADD CONSTRAINT bi_suppressions_reason_check
      CHECK (reason IN ('manual','unsubscribe','bounce','complaint','imported','reply_negative','deleted_from_crm')) NOT VALID;
  END IF;
END $$;
