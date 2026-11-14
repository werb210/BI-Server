-- BI_SERVER_FIELD_REPS_v1 - outside reps (brokers) who collect contacts at events. Each rep has a short code (in their
-- page link and QR code) and a PIN. Every contact they add, and every person who uses their QR code, is logged against
-- them so they get credit when that contact sends deals.
CREATE TABLE IF NOT EXISTS bi_field_reps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  full_name text NOT NULL,
  company_name text,
  email text,
  phone_e164 text,
  pin_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  failed_pins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bi_field_reps_code_uq ON bi_field_reps (lower(code));

CREATE TABLE IF NOT EXISTS bi_field_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id uuid NOT NULL REFERENCES bi_field_reps(id),
  full_name text,
  company_name text,
  title text,
  email text,
  phone_e164 text,
  notes text,
  source text NOT NULL DEFAULT 'manual',
  contact_id uuid,
  track_token text NOT NULL,
  email_sent_at timestamptz,
  email_opened_at timestamptz,
  email_error text,
  sms_due_at timestamptz,
  sms_sent_at timestamptz,
  sms_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bi_field_contacts_source_check CHECK (source IN ('card', 'manual', 'qr'))
);
CREATE UNIQUE INDEX IF NOT EXISTS bi_field_contacts_token_uq ON bi_field_contacts (track_token);
CREATE INDEX IF NOT EXISTS bi_field_contacts_rep_idx ON bi_field_contacts (rep_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bi_field_contacts_sms_due_idx ON bi_field_contacts (sms_due_at) WHERE sms_sent_at IS NULL AND sms_due_at IS NOT NULL;
