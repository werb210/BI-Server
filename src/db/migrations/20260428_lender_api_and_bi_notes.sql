-- BI_V1_FINAL_v47 — idempotent.
CREATE TABLE IF NOT EXISTS bi_lender_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_id     UUID NOT NULL REFERENCES bi_lenders(id) ON DELETE CASCADE,
  key_prefix    TEXT NOT NULL,                     -- first 12 chars, for lookup
  key_hash      TEXT NOT NULL,                     -- sha256 hex of the full secret
  label         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bi_lender_api_keys_prefix ON bi_lender_api_keys(key_prefix) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS bi_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES bi_applications(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  owner_user_id   UUID,
  mentions        TEXT[] NOT NULL DEFAULT '{}',
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_notes_application_id ON bi_notes(application_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_bi_notes_mentions       ON bi_notes USING GIN (mentions);
