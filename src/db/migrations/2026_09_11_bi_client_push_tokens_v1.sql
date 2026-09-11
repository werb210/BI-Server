-- BI_SERVER_PUSH_TOKENS_v159
-- BI-Client registers a push token on every launch but had nowhere to send it:
-- src/native/pushNotifications.ts carries an explicit note that BI-Server has
-- no device-registration endpoint and that callers must not invent a URL. This
-- is that endpoint's storage.
--
-- Keyed on the token, because a device's token is the thing that must be
-- unique; a person may have several devices, and a device may be handed to a
-- different applicant, in which case the row is reassigned rather than doubled.
CREATE TABLE IF NOT EXISTS bi_client_push_tokens (
  token          TEXT PRIMARY KEY,
  applicant_phone TEXT,
  platform       TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sending to an applicant means looking up every device they hold.
CREATE INDEX IF NOT EXISTS bi_client_push_tokens_phone_idx
  ON bi_client_push_tokens (applicant_phone);
