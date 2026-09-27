-- BI_SERVER_BLOCK_v601
CREATE TABLE IF NOT EXISTS bi_applicant_passkeys (
  credential_id text PRIMARY KEY, phone_e164 text NOT NULL, public_key_pem text NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0, label varchar(80), transports jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS bi_applicant_passkeys_phone_idx ON bi_applicant_passkeys(phone_e164) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS bi_applicant_passkey_challenges (
  challenge text PRIMARY KEY, phone_e164 text, ceremony text NOT NULL CHECK (ceremony IN ('register','authenticate')),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bi_applicant_passkey_challenges_expiry_idx ON bi_applicant_passkey_challenges(expires_at);
