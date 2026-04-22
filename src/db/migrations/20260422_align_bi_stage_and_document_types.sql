DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname='bi_pipeline_stage') THEN
    ALTER TYPE bi_pipeline_stage ADD VALUE IF NOT EXISTS 'approved';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname='bi_document_type') THEN
    ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'other';
  END IF;
END $$;

ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS core_score NUMERIC;
