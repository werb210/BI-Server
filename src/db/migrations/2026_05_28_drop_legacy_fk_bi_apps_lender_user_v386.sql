-- BI_SERVER_BLOCK_v386_DROP_LEGACY_FK_AND_INTEGRATION_TEST_v1
-- v385 attempted to realign the FK on bi_applications.created_by_lender_user_id
-- but specified the wrong constraint name in its DROP. v243's
-- fk_bi_apps_lender_user (referencing the obsolete bi_lender_contacts table)
-- survived v385 and coexists with v385's new FK on the same column.
-- INSERTs that satisfy the modern FK fail on the legacy one. This finishes
-- what v385 intended. Idempotent via DROP CONSTRAINT IF EXISTS.
BEGIN;
ALTER TABLE bi_applications DROP CONSTRAINT IF EXISTS fk_bi_apps_lender_user;
COMMIT;
