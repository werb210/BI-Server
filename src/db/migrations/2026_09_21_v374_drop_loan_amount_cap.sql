-- BI_BF_HANDOFF_LOAN_CAP_v374
-- bi_applications_loan_amount_max_chk capped the LOAN at $1,000,000, but the
-- carrier cap is on the guarantee (pgi_limit, which keeps its own CHECK).
-- Northern Gateway Films' BF->BI handoff 500ed on this on 2026-09-21 and the
-- application never reached BI. Idempotent.
ALTER TABLE bi_applications DROP CONSTRAINT IF EXISTS bi_applications_loan_amount_max_chk;
