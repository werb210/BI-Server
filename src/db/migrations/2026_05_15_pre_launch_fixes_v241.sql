-- BI_SERVER_BLOCK_v241_PRE_LAUNCH_FIXES_v1
DO $$ BEGIN
  ALTER TYPE bi_pipeline_stage ADD VALUE IF NOT EXISTS 'submitted';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE OR REPLACE FUNCTION bi_stage_from_status(s TEXT) RETURNS bi_pipeline_stage AS $$
BEGIN
  RETURN CASE
    WHEN s IS NULL THEN 'new_application'::bi_pipeline_stage
    WHEN s = '' THEN 'new_application'::bi_pipeline_stage
    WHEN s = 'created' THEN 'new_application'::bi_pipeline_stage
    WHEN s = 'in_progress' THEN 'new_application'::bi_pipeline_stage
    WHEN s = 'new_application' THEN 'new_application'::bi_pipeline_stage
    WHEN s = 'ready_for_submission' THEN 'new_application'::bi_pipeline_stage
    WHEN s = 'document_review' THEN 'documents_pending'::bi_pipeline_stage
    WHEN s = 'submitted' THEN 'submitted'::bi_pipeline_stage
    WHEN s = 'under_review' THEN 'under_review'::bi_pipeline_stage
    WHEN s = 'information_required' THEN 'under_review'::bi_pipeline_stage
    WHEN s = 'approved' THEN 'under_review'::bi_pipeline_stage
    WHEN s = 'declined' THEN 'declined'::bi_pipeline_stage
    WHEN s = 'policy_issued' THEN 'bound'::bi_pipeline_stage
    ELSE NULL
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
CREATE OR REPLACE FUNCTION bi_sync_stage_trigger() RETURNS TRIGGER AS $$
DECLARE mapped bi_pipeline_stage;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    mapped := bi_stage_from_status(NEW.status);
    IF mapped IS NOT NULL THEN NEW.stage := mapped; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS bi_sync_stage ON bi_applications;
CREATE TRIGGER bi_sync_stage BEFORE INSERT OR UPDATE OF status ON bi_applications FOR EACH ROW EXECUTE FUNCTION bi_sync_stage_trigger();
UPDATE bi_applications SET stage = bi_stage_from_status(status)
 WHERE bi_stage_from_status(status) IS NOT NULL
   AND stage IS DISTINCT FROM bi_stage_from_status(status);
