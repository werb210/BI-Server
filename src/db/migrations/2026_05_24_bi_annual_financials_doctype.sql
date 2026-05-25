DO $$ BEGIN
  ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_financials_3yr';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
