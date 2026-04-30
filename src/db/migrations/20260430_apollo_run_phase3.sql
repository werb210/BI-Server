-- BI_APOLLO_RUN_v55_PHASE3 — campaign-readiness schema.
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS icp_segment  TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'unknown';
CREATE INDEX IF NOT EXISTS idx_bi_contacts_icp ON bi_contacts(icp_segment) WHERE icp_segment IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bi_contacts_email_status ON bi_contacts(email_status);
CREATE TABLE IF NOT EXISTS bi_apollo_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), apollo_sequence_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  icp_segment TEXT, owner_user_id UUID, status TEXT NOT NULL DEFAULT 'active', last_synced_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS bi_apollo_email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), apollo_account_id TEXT UNIQUE NOT NULL, email TEXT NOT NULL,
  daily_send_count INT NOT NULL DEFAULT 0, daily_send_date DATE, bounce_rate_30d NUMERIC(5,4), reply_rate_30d NUMERIC(5,4),
  status TEXT NOT NULL DEFAULT 'unknown', raw_data JSONB, last_synced_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS bi_marketing_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), contact_id UUID REFERENCES bi_contacts(id) ON DELETE CASCADE,
  apollo_contact_id TEXT, apollo_message_id TEXT UNIQUE, apollo_sequence_id TEXT, sequence_name TEXT, replied_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', assigned_to_user_id UUID, notes TEXT, closed_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_bi_marketing_replies_status ON bi_marketing_replies(status, replied_at DESC);
CREATE INDEX IF NOT EXISTS idx_bi_marketing_replies_contact ON bi_marketing_replies(contact_id);
ALTER TABLE bi_crm_engagement_events ADD COLUMN IF NOT EXISTS apollo_sequence_id TEXT;
CREATE INDEX IF NOT EXISTS idx_bi_engagement_sequence ON bi_crm_engagement_events(apollo_sequence_id, occurred_at DESC);
ALTER TABLE bi_apollo_sync_state ADD COLUMN IF NOT EXISTS last_email_account_sync_at TIMESTAMP;
ALTER TABLE bi_apollo_sync_state ADD COLUMN IF NOT EXISTS last_sequence_sync_at TIMESTAMP;
