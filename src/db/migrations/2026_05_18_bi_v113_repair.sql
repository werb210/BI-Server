-- Block 113 repair: idempotently recreate Block 110 sequence tables in case v110 was skipped.
CREATE TABLE IF NOT EXISTS bi_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_user_id UUID NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bi_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES bi_sequences(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  delay_days INT NOT NULL DEFAULT 0,
  subject TEXT NOT NULL,
  body_template TEXT NOT NULL,
  send_as_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sequence_id, step_number)
);

CREATE TABLE IF NOT EXISTS bi_sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES bi_sequences(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES bi_contacts(id) ON DELETE CASCADE,
  enrolled_by_user_id UUID NOT NULL,
  current_step INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','stopped','replied')),
  next_send_at TIMESTAMPTZ,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(sequence_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_bi_seq_enrollments_next ON bi_sequence_enrollments(next_send_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS bi_sequence_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES bi_sequence_enrollments(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  m365_message_id TEXT,
  m365_thread_id TEXT,
  from_user_id UUID NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed','bounced','replied')),
  error_message TEXT,
  attempts INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bi_seq_sends_thread ON bi_sequence_sends(m365_thread_id);

CREATE TABLE IF NOT EXISTS bi_user_send_quotas (
  user_id UUID PRIMARY KEY,
  daily_limit INT NOT NULL DEFAULT 50,
  sent_today INT NOT NULL DEFAULT 0,
  quota_date DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Block 113 Apollo enrichment columns.
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS manually_edited_fields JSONB DEFAULT '[]'::jsonb;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS organization_name TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS organization_industry TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS phone_numbers JSONB DEFAULT '[]'::jsonb;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS country TEXT;

-- Allow the enrichment endpoint to write a first-class activity event.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'bi_contact_activity'
      AND constraint_name = 'bi_contact_activity_kind_check'
  ) THEN
    ALTER TABLE bi_contact_activity DROP CONSTRAINT bi_contact_activity_kind_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bi_contact_activity' AND column_name = 'kind'
  ) THEN
    ALTER TABLE bi_contact_activity
      ADD CONSTRAINT bi_contact_activity_kind_check
      CHECK (kind IN ('email_sent','email_replied','email_bounced','sms_sent','sms_replied','call_started','call_ended','call_missed','stage_changed','tag_added','tag_removed','note','sequence_enrolled','promoted_to_lender','enriched'));
  END IF;
END $$;
