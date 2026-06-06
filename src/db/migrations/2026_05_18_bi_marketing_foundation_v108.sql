CREATE TABLE IF NOT EXISTS bi_outreach_stages (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  ordinal INT NOT NULL,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  hidden_by_default BOOLEAN NOT NULL DEFAULT FALSE,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO bi_outreach_stages (id, label, ordinal, is_terminal, hidden_by_default, color) VALUES
  ('new', 'New', 1, FALSE, FALSE, '#9ca3af'),
  ('queued', 'Queued', 2, FALSE, FALSE, '#60a5fa'),
  ('contacted', 'Contacted', 3, FALSE, FALSE, '#38bdf8'),
  ('engaged', 'Engaged', 4, FALSE, FALSE, '#a78bfa'),
  ('meeting_booked', 'Meeting booked', 5, FALSE, FALSE, '#f59e0b'),
  ('qualified', 'Qualified', 6, FALSE, FALSE, '#10b981'),
  ('nurture', 'Nurture', 7, FALSE, FALSE, '#f97316'),
  ('disqualified', 'Disqualified', 8, TRUE, TRUE, '#6b7280')
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, ordinal = EXCLUDED.ordinal, is_terminal = EXCLUDED.is_terminal, hidden_by_default = EXCLUDED.hidden_by_default, color = EXCLUDED.color;

ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS outreach_stage TEXT REFERENCES bi_outreach_stages(id) DEFAULT 'new';
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS promoted_lender_id UUID;
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS tags TEXT[];

-- v108 fresh-replay fix: outreach_status is created by a later migration.
-- Defer the reference via dynamic SQL so it is only parsed when the column
-- actually exists. (No-op on prod, where this file already applied.)
DO $v108_outreach$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bi_contacts' AND column_name = 'outreach_status'
  ) THEN
    EXECUTE $q$
      UPDATE bi_contacts
         SET outreach_stage = COALESCE(NULLIF(outreach_status, ''), 'new')
       WHERE outreach_stage IS NULL
    $q$;
  END IF;
END
$v108_outreach$;

CREATE INDEX IF NOT EXISTS idx_bi_contacts_outreach_stage ON bi_contacts(outreach_stage);
CREATE INDEX IF NOT EXISTS idx_bi_contacts_owner_user_id ON bi_contacts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_bi_contacts_industry ON bi_contacts(industry);

CREATE TABLE IF NOT EXISTS bi_industry_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry TEXT NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bi_contact_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES bi_contacts(id) ON DELETE CASCADE,
  actor_user_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('email_sent','email_replied','email_bounced','sms_sent','sms_replied','call_started','call_ended','call_missed','stage_changed','tag_added','tag_removed','note','sequence_enrolled','promoted_to_lender')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_contact_activity_contact ON bi_contact_activity(contact_id, occurred_at DESC);
