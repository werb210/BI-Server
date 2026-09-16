-- BI_SERVER_APPLICANT_FACE_ID_v300
-- Face ID sign-in for BI-Client. Only a SHA-256 hash of the device secret is
-- stored; the secret lives on the phone behind Face ID and rotates each use.
CREATE TABLE IF NOT EXISTS bi_applicant_device_credentials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164   text NOT NULL,
  secret_hash  text NOT NULL,
  device_label text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '180 days'),
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_bi_applicant_device_credentials_phone ON bi_applicant_device_credentials (phone_e164) WHERE revoked_at IS NULL;
