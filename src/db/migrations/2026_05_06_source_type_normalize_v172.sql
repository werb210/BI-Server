-- BI_SERVER_BLOCK_v172_SOURCE_TYPE_NORMALIZE_v1
-- Align bi_applications.source_type with bi_applications.source for
-- existing rows. The two columns coexist (different migrations added
-- each); historically only `source` was set explicitly, so source_type
-- defaulted to 'public' for every row including lender-API submissions.
--
-- Per V1 spec ruling 5, source_type values are: 'public', 'lender',
-- 'referrer'. The legacy 'lender_api' value is normalized to 'lender'.
-- Idempotent.

UPDATE bi_applications
   SET source_type = CASE
         WHEN source IN ('lender', 'lender_api') THEN 'lender'
         WHEN source = 'referrer' THEN 'referrer'
         WHEN source = 'public' THEN 'public'
         ELSE source_type
       END
 WHERE source IS NOT NULL
   AND source_type IS DISTINCT FROM CASE
         WHEN source IN ('lender', 'lender_api') THEN 'lender'
         WHEN source = 'referrer' THEN 'referrer'
         WHEN source = 'public' THEN 'public'
         ELSE source_type
       END;

-- Also normalize the source column itself: 'lender_api' -> 'lender'.
UPDATE bi_applications
   SET source = 'lender'
 WHERE source = 'lender_api';

DO $$ BEGIN RAISE NOTICE 'BI_SERVER_BLOCK_v172_SOURCE_TYPE_NORMALIZE_v1 applied'; END $$;
