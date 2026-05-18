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
