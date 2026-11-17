-- BI_SERVER_REP_AGREEMENT_v1 - a rep added from the Reps screen is sent the PGI Introducer Agreement (signed through
-- SignNow, issued by BF-Server) and their page stays locked until it is signed. Reps that existed before this
-- (agreement_required = false) are left as they are.
ALTER TABLE bi_field_reps ADD COLUMN IF NOT EXISTS agreement_required boolean NOT NULL DEFAULT false;
ALTER TABLE bi_field_reps ADD COLUMN IF NOT EXISTS agreement_group_id text;
ALTER TABLE bi_field_reps ADD COLUMN IF NOT EXISTS agreement_invite_id text;
ALTER TABLE bi_field_reps ADD COLUMN IF NOT EXISTS agreement_document_id text;
ALTER TABLE bi_field_reps ADD COLUMN IF NOT EXISTS agreement_version text;
ALTER TABLE bi_field_reps ADD COLUMN IF NOT EXISTS agreement_sent_at timestamptz;
ALTER TABLE bi_field_reps ADD COLUMN IF NOT EXISTS agreement_signed_at timestamptz;
ALTER TABLE bi_field_reps ADD COLUMN IF NOT EXISTS agreement_error text;
