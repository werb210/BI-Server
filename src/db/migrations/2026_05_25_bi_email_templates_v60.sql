-- BI_SERVER_BLOCK_60_MAILBOX_ENGAGEMENT_TEMPLATES_v1
CREATE TABLE IF NOT EXISTS bi_email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_email_templates_active ON bi_email_templates(is_active, name);
CREATE INDEX IF NOT EXISTS idx_bi_email_templates_category ON bi_email_templates(category) WHERE category IS NOT NULL;
