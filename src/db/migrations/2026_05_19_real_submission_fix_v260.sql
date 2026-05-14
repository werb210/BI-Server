-- BI_SERVER_BLOCK_v260_CARRIER_PATH_E2E_FIX_v1
--
-- (A) bi_applications: the lender INSERT in
--     src/routes/biLenderApplicationCreate.ts:45 writes lender_notes
--     and company_name. Neither column was ever created.
ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS lender_notes TEXT,
  ADD COLUMN IF NOT EXISTS company_name TEXT;

-- (B) bi_document_type enum: the BI-Website wizard's
--     RequiredDocumentsList (public) and lenderFormShared DOC_SLOTS
--     (lender portal) send slot keys that aren't valid enum values.
--     Each on its own statement so the v66 migration runner's
--     extractor regex matches and pre-commits the new values OUTSIDE
--     the per-file transaction. Without this the doc upload INSERT
--     returns 400 'invalid_doc_type' and the applicant can never
--     reach document_review state.
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'pl_12mo';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'forecast';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'gov_id_primary';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'gov_id_secondary';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_y1';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_y2';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_y3';
