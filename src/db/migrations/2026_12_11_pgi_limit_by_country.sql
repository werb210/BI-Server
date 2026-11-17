-- BI_SERVER_US_PGI_LIMIT_CAP_v1
-- bi_applications_pgi_limit_max_chk capped every guarantee at $1,000,000. That is the Canadian
-- ceiling; United States files may insure up to $5,000,000 (src/lib/validation/marketLimits.ts).
-- A US application for a $1,800,000 guarantee failed with a 500 on 2026-11-17 because of it.
-- The rule now follows the country of the business. Idempotent.
ALTER TABLE bi_applications DROP CONSTRAINT IF EXISTS bi_applications_pgi_limit_max_chk;
ALTER TABLE bi_applications ADD CONSTRAINT bi_applications_pgi_limit_max_chk CHECK (
  pgi_limit IS NULL
  OR pgi_limit <= CASE
       WHEN upper(btrim(coalesce(country, ''))) IN ('US', 'USA', 'UNITED STATES') THEN 5000000
       ELSE 1000000
     END
);
