-- BI_SERVER_BLOCK_v262_CARRIER_PATH_E2E_FIX_v3
-- (A) bi_applications: columns the lender INSERT writes but no
--     prior migration created.
ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS lender_notes TEXT,
  ADD COLUMN IF NOT EXISTS company_name TEXT;

-- (B) bi_document_type enum: 7 slot keys the BI-Website wizard
--     sends that aren't valid enum values. Each on its own line so
--     the v66 migration runner's pre-commit extractor picks them up.
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'pl_12mo';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'forecast';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'gov_id_primary';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'gov_id_secondary';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_y1';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_y2';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_y3';
