-- BI_SERVER_FIELD_REP_PIN_RECOVERY_v1 - when a rep last asked for a new PIN, so one cannot be requested over and over.
ALTER TABLE bi_field_reps ADD COLUMN IF NOT EXISTS pin_sent_at timestamptz;
