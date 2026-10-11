-- BI_SERVER_BLOCK_v789_IDEMPOTENT: guarded so a re-run is a no-op (the runner no longer
-- treats "already exists" as applied). Already recorded as applied in production.
ALTER TABLE maya_leads
ADD COLUMN IF NOT EXISTS referral_code TEXT,
ADD COLUMN IF NOT EXISTS utm_source TEXT,
ADD COLUMN IF NOT EXISTS utm_medium TEXT,
ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
ADD COLUMN IF NOT EXISTS crm_status TEXT;
