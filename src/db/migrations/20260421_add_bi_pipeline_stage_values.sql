DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname='bi_pipeline_stage') THEN
    ALTER TYPE bi_pipeline_stage ADD VALUE IF NOT EXISTS 'quoted';
    ALTER TYPE bi_pipeline_stage ADD VALUE IF NOT EXISTS 'bound';
    ALTER TYPE bi_pipeline_stage ADD VALUE IF NOT EXISTS 'claim';
  END IF;
END $$;
