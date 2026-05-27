-- BI_SERVER_BLOCK_v385_FK_LENDER_USER_REALIGN_v1
-- v243 added fk_bi_apps_lender_user pointing to bi_lender_contacts(id).
-- Since then the canonical lender-contact table has become
-- bi_lender_login_contacts (queried by biLenderApiRoutes.ts:411-459
-- /lender/otp/verify, which packs contact_id INTO the JWT.user_id).
-- Result: every real-lender OTP login mints a JWT whose user_id is in
-- bi_lender_login_contacts but NOT in bi_lender_contacts, so the
-- INSERT into bi_applications fails with the v243 FK violation.
-- Demo path is unaffected because demo JWTs carry no user_id ($12=null).

-- Safety: NULL any orphan rows (created_by_lender_user_id NOT in the
-- new target) before re-pointing, so the FK can be added cleanly.
UPDATE bi_applications a
   SET created_by_lender_user_id = NULL
 WHERE a.created_by_lender_user_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM bi_lender_login_contacts c WHERE c.id = a.created_by_lender_user_id
   );

-- Drop the v243 FK if it still points to bi_lender_contacts.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.referential_constraints rc
     JOIN information_schema.constraint_table_usage tu
       ON tu.constraint_name = rc.constraint_name
    WHERE rc.constraint_name = 'fk_bi_apps_lender_user'
      AND tu.table_name = 'bi_lender_contacts'
  ) THEN
    ALTER TABLE bi_applications DROP CONSTRAINT fk_bi_apps_lender_user;
  END IF;
END $$;

-- Add the new FK pointing to bi_lender_login_contacts. ON DELETE SET NULL
-- so deleting a login contact doesn't cascade-delete applications.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.referential_constraints rc
     JOIN information_schema.constraint_table_usage tu
       ON tu.constraint_name = rc.constraint_name
    WHERE rc.constraint_name = 'fk_bi_apps_lender_user'
      AND tu.table_name = 'bi_lender_login_contacts'
  ) THEN
    ALTER TABLE bi_applications
      ADD CONSTRAINT fk_bi_apps_lender_user
      FOREIGN KEY (created_by_lender_user_id)
      REFERENCES bi_lender_login_contacts(id)
      ON DELETE SET NULL;
  END IF;
END $$;
