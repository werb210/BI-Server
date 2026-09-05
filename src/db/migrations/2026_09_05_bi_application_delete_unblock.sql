-- BI_APPLICATION_DELETE_UNBLOCK_v1
-- Store-required in-app account deletion needs an applicant to delete their own
-- bi_applications. Two FKs to bi_applications had no ON DELETE rule and would
-- block the delete. Relax both to SET NULL so the delete succeeds WITHOUT
-- destroying commission/ledger financial records (their app link is nulled).
ALTER TABLE bi_referrer_commissions ALTER COLUMN application_id DROP NOT NULL;
ALTER TABLE bi_referrer_commissions DROP CONSTRAINT IF EXISTS bi_referrer_commissions_application_id_fkey;
ALTER TABLE bi_referrer_commissions
  ADD CONSTRAINT bi_referrer_commissions_application_id_fkey
  FOREIGN KEY (application_id) REFERENCES bi_applications(id) ON DELETE SET NULL;

ALTER TABLE bi_commission_ledger DROP CONSTRAINT IF EXISTS bi_commission_ledger_application_id_fkey;
ALTER TABLE bi_commission_ledger
  ADD CONSTRAINT bi_commission_ledger_application_id_fkey
  FOREIGN KEY (application_id) REFERENCES bi_applications(id) ON DELETE SET NULL;
