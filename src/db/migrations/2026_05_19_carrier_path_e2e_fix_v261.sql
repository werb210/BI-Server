-- BI_SERVER_BLOCK_v261_CARRIER_PATH_E2E_FIX_v2
-- (A) bi_applications: columns the lender INSERT writes that no
--     prior migration created.
ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS lender_notes TEXT,
  ADD COLUMN IF NOT EXISTS company_name TEXT;

-- (B) bi_document_type enum: 7 slot keys the BI-Website wizard
--     sends that aren't valid enum values. One per statement so
--     the v66 migration runner pre-commits each value outside the
--     per-file transaction.
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'pl_12mo';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'forecast';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'gov_id_primary';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'gov_id_secondary';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_y1';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_y2';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_y3';
