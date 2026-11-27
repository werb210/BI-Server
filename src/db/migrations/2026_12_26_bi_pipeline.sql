-- BI_SERVER_PIPELINE_v1 (2026-11-27) - Todd: the PGI outreach is a sales pipeline. Each contact sits in one stage:
-- emailed, opened, clicked, replied, staff responded, follow-up, initial call, demo, signed up, not interested.
-- Adds what the stages need beyond the first version: their latest reply, when staff last answered them (BF-Server
-- reads staff Sent Items), which email they replied to, and the demo date. Idempotent.
ALTER TABLE bi_engagement ADD COLUMN IF NOT EXISTS last_reply_at timestamptz;
ALTER TABLE bi_engagement ADD COLUMN IF NOT EXISTS responded_at timestamptz;
ALTER TABLE bi_engagement ADD COLUMN IF NOT EXISTS replied_key text;
ALTER TABLE bi_engagement ADD COLUMN IF NOT EXISTS demo_at timestamptz;
UPDATE bi_engagement SET last_reply_at = replied_at WHERE last_reply_at IS NULL AND replied_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS bi_engagement_stage_at_idx ON bi_engagement (stage, stage_at DESC);
