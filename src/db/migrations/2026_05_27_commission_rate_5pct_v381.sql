-- BI_SERVER_BLOCK_v381_COMMISSION_RATE_5PCT_v1
-- Flip the bi_commissions.commission_rate column default from 0.10 to 0.05.
-- Operator-confirmed 2026-05-26: Boreal's commission rate is 5% of annual
-- premium, not 10% as the v1 master schema declared.
--
-- This migration is forward-only. Existing rows keep whatever commission_rate
-- and commission_amount they were inserted with. The webhook handler at
-- pgiWebhookRoutes.ts:111-124 (v381 fix) now writes commission_rate=0.05
-- explicitly on every new policy.bound, so the rate column will be correct
-- on all rows created from v381 onward regardless of this default.
--
-- Idempotent: ALTER COLUMN SET DEFAULT is safe to re-apply.

BEGIN;

ALTER TABLE bi_commissions
  ALTER COLUMN commission_rate SET DEFAULT 0.05;

COMMIT;
