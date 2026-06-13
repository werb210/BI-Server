-- CRM parity: per-company staff ownership (owner filter / column / bulk-assign).
ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS owner_id UUID;
