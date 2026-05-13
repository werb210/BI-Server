-- BI_SERVER_BLOCK_v250_MAYA_STAFF_PIPELINE_QUERY_v1
-- Per-tool-execution audit log for BI-side Maya queries. Mirrors
-- the BF-Server maya_audit table contract so cross-silo auditing
-- is straightforward, but lives in the BI database so the BI
-- silo is self-contained. Audience always 'staff' on this
-- endpoint; gen_random_uuid() relies on pgcrypto being available
-- (every existing BI migration already does).
CREATE TABLE IF NOT EXISTS bi_maya_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  audience        TEXT NOT NULL CHECK (audience IN ('visitor','client','staff')),
  service_source  TEXT,
  tool            TEXT NOT NULL,
  args_redacted   JSONB,
  result_summary  TEXT,
  ok              BOOLEAN NOT NULL DEFAULT TRUE,
  error_code      TEXT
);
CREATE INDEX IF NOT EXISTS idx_bi_maya_audit_ts
  ON bi_maya_audit(ts DESC);
CREATE INDEX IF NOT EXISTS idx_bi_maya_audit_audience_tool
  ON bi_maya_audit(audience, tool);
