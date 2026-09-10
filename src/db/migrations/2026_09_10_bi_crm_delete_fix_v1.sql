-- BI_CRM_DELETE_FIX_v1
-- bi_marketing_send_recipients.contact_id was created without an ON DELETE
-- rule, so it defaults to NO ACTION and blocks deleting any contact that has
-- ever been in a marketing send. Every other FK to bi_contacts cascades.
-- A send-recipient row has no meaning without its contact, so cascade.
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT con.conname INTO fk_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_class frel ON frel.oid = con.confrelid
   WHERE rel.relname = 'bi_marketing_send_recipients'
     AND frel.relname = 'bi_contacts'
     AND con.contype = 'f'
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE bi_marketing_send_recipients DROP CONSTRAINT %I', fk_name);
    ALTER TABLE bi_marketing_send_recipients
      ADD CONSTRAINT bi_marketing_send_recipients_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES bi_contacts(id) ON DELETE CASCADE;
  END IF;
END $$;
