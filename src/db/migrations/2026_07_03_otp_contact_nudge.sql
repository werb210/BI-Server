-- BI_SERVER_OTP_CONTACT_NUDGE_v1 - SMS nudge flags for contacts who verified
-- their phone (OTP) but never started an application. Timestamps (not tags)
-- because the 24h second-nudge needs to know WHEN the first went out.
ALTER TABLE bi_contacts
  ADD COLUMN IF NOT EXISTS otp_nudge_sent_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS otp_nudge2_sent_at TIMESTAMP;
