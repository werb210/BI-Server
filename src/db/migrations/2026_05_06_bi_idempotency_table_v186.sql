-- BI_SERVER_BLOCK_v186_IDEMPOTENCY_TABLE_v1
-- bi_idempotency table. Code at src/modules/policy.service.ts INSERTs
-- idempotency keys to prevent duplicate policy creation when a request
-- is retried. UNIQUE on id. No prior migration creates the table.
-- Same defensive pattern as v171 (job_queue) and v175 (bi_policies).

CREATE TABLE IF NOT EXISTS bi_idempotency (
  id TEXT PRIMARY KEY,
  scope TEXT,
  payload_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

ALTER TABLE bi_idempotency
  ADD COLUMN IF NOT EXISTS scope TEXT,
  ADD COLUMN IF NOT EXISTS payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS bi_idempotency_expires_idx
  ON bi_idempotency(expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS bi_idempotency_created_idx
  ON bi_idempotency(created_at DESC);

DO $$ BEGIN RAISE NOTICE 'BI_SERVER_BLOCK_v186_IDEMPOTENCY_TABLE_v1 applied'; END $$;
