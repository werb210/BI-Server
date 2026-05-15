-- BI_SERVER_BLOCK_v244_DEMO_REFERRER_STORAGE_v1
-- Re-assert is_demo=TRUE on the dedicated demo lender provisioned by
-- v226. In at least one production deploy this row's is_demo column
-- ended up FALSE (cause unknown — possible manual SQL touch or partial
-- v226 rollback). The BI-Website's "Live Demo" lender path then
-- silently misclassified its submissions: they got is_demo=FALSE on
-- INSERT, disappeared from the demo pipeline (which filters
-- is_demo=TRUE), and showed up in the real pipeline once the user
-- hit "Exit demo" (which filters is_demo IS NOT TRUE).
--
-- The code-side fix (biLenderApplicationCreate.ts in this same wave)
-- reads is_demo from the JWT claim, so future writes are correct even
-- if the bi_lenders row drifts. This migration backfills the row so
-- both code paths agree.
--
-- Idempotent: no-op if the row is already correct.

UPDATE bi_lenders
   SET is_demo   = TRUE,
       is_active = TRUE
 WHERE contact_phone_e164 = '+15875550000'
   AND (is_demo IS DISTINCT FROM TRUE OR is_active IS DISTINCT FROM TRUE);
