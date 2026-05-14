-- BI_SERVER_BLOCK_v259_REAL_SUBMISSION_FIX_v2
-- End-to-end fix for the public + lender carrier path.
--
-- (A) bi_applications: add the two columns the lender INSERT writes but
--     no prior migration has created.
ALTER TABLE bi_applications
  ADD COLUMN IF NOT EXISTS lender_notes TEXT,
  ADD COLUMN IF NOT EXISTS company_name TEXT;

-- (B) bi_document_type enum: add the 7 slot keys the BI-Website wizard
--     sends that aren't currently enum values. Without these the public
--     POST /applications/:publicId/documents fails with 400
--     'invalid_doc_type' and the applicant cannot advance to
--     document_review (so staff never gets the carrier-forward button).
--
-- Each ALTER TYPE ADD VALUE is on its own statement so the v66 runner's
-- pre-commit extractor regex matches each one and commits the new
-- values outside the per-file transaction.
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'pl_12mo';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'forecast';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'gov_id_primary';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'gov_id_secondary';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_y1';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_y2';
ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'annual_y3';
