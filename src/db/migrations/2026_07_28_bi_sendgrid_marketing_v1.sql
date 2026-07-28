ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS marketing_consent_basis TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS marketing_consent_source TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS marketing_consent_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS bi_marketing_send_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES bi_email_templates(id),
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text_body TEXT,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','cancelled','failed')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_bi_marketing_send_jobs_drain ON bi_marketing_send_jobs(status, scheduled_at);

CREATE TABLE IF NOT EXISTS bi_marketing_send_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES bi_marketing_send_jobs(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES bi_contacts(id),
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','failed','skipped')),
  accepted_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_bi_marketing_send_recipients_pending ON bi_marketing_send_recipients(job_id, status);
