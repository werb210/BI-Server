-- BI_SERVER_BLOCK_v243_LENDER_STAGE_ROUTING_v1
-- Migrate legacy bi_applications.status='submitted' rows from lender-
-- sourced submissions to status='sent_to_pgi' so they show up in the
-- new BF-portal "Sent to PGI" pipeline column added in v47.
--
-- Pre-v243 lender flow: biLenderApplicationCreate INSERTed with
-- status='new_application', then UPDATEd to status='submitted' after
-- pgiSubmit success. Post-v243: it UPDATEs to status='sent_to_pgi'
-- directly. This migration brings legacy rows into the new world.
--
-- We scope the UPDATE to source='lender' rows that have a non-null
-- pgi_application_id (i.e. they actually reached PGI), to avoid
-- accidentally flipping public-flow submissions whose status='submitted'
-- might mean something different in legacy data.
--
-- Idempotent: subsequent runs will find zero matching rows.

UPDATE bi_applications
   SET status='sent_to_pgi',
       updated_at=NOW()
 WHERE status='submitted'
   AND source='lender'
   AND pgi_application_id IS NOT NULL;
