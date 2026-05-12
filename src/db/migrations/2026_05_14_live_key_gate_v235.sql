-- BI_SERVER_BLOCK_v235_LIVE_KEY_GATE_v1
ALTER TABLE bi_lenders ADD COLUMN IF NOT EXISTS live_keys_enabled BOOLEAN NOT NULL DEFAULT FALSE;
-- Demo lenders (e.g. Andrew, who runs sales demos) get live access
-- by default so the gate doesn't disrupt the existing test fleet.
UPDATE bi_lenders SET live_keys_enabled = TRUE WHERE is_demo = TRUE AND live_keys_enabled = FALSE;
