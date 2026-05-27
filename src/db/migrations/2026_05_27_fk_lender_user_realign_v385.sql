-- BI_SERVER_BLOCK_v385
-- Realign lender user FKs to bi_lender_login_contacts.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='bi_applications' AND column_name='created_by_lender_user_id'
  ) THEN
    ALTER TABLE bi_applications DROP CONSTRAINT IF EXISTS bi_applications_created_by_lender_user_id_fkey;
    ALTER TABLE bi_applications
      ADD CONSTRAINT bi_applications_created_by_lender_user_id_fkey
      FOREIGN KEY (created_by_lender_user_id)
      REFERENCES bi_lender_login_contacts(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
