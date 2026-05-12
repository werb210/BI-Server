-- BI_SERVER_BLOCK_v234_OPS_HARDENING_v1
CREATE TABLE IF NOT EXISTS bi_sms_opt_outs (
  phone_e164    TEXT PRIMARY KEY,
  opted_out_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source        TEXT,
  raw_body      TEXT
);
