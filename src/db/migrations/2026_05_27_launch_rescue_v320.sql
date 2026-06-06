-- BI_SERVER_BLOCK_v320_LAUNCH_RESCUE_v1
-- Production migrations table says these are applied but the columns are
-- missing. Defensive re-add. Idempotent.

-- 1. bi_crm_engagement_events.occurred_at  (apollo engagement sync target)
CREATE TABLE IF NOT EXISTS bi_crm_engagement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID,
  apollo_contact_id TEXT,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'apollo',
  apollo_message_id TEXT,
  apollo_sequence_id TEXT,
  sequence_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bi_crm_engagement_events' AND column_name='occurred_at') THEN
    ALTER TABLE bi_crm_engagement_events ADD COLUMN occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_crm_engagement_events_msg_evt
  ON bi_crm_engagement_events(apollo_message_id, event_type)
  WHERE apollo_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bi_engagement_occurred_at
  ON bi_crm_engagement_events(occurred_at DESC);

-- 2. bi_sequence_enrollments.next_send_at  (sequence-send worker target)
CREATE TABLE IF NOT EXISTS bi_sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL,
  sequence_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_step INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bi_sequence_enrollments' AND column_name='next_send_at') THEN
    ALTER TABLE bi_sequence_enrollments ADD COLUMN next_send_at TIMESTAMPTZ;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bi_seq_enrollments_next
  ON bi_sequence_enrollments(next_send_at) WHERE status='active';

-- 3. bi_user_send_quotas.quota_date  (per-day quota worker target)
CREATE TABLE IF NOT EXISTS bi_user_send_quotas (
  user_id UUID PRIMARY KEY,
  daily_limit INTEGER NOT NULL DEFAULT 0,
  sent_today INTEGER NOT NULL DEFAULT 0,
  window_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bi_user_send_quotas' AND column_name='quota_date') THEN
    ALTER TABLE bi_user_send_quotas ADD COLUMN quota_date DATE NOT NULL DEFAULT CURRENT_DATE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bi_user_send_quotas_quota_date
  ON bi_user_send_quotas(quota_date);

-- 4. bi_contacts.email — partial UNIQUE index so ON CONFLICT (email) actually works.
WITH ranked AS (
  SELECT id, email,
         ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(email))
                            ORDER BY created_at NULLS LAST, id) AS rn
    FROM bi_contacts
   WHERE email IS NOT NULL AND TRIM(email) <> ''
)
UPDATE bi_contacts c
   SET email = c.email || '+dup' || r.rn::text || '@bi.local',
       tags  = COALESCE(c.tags, ARRAY[]::text[]) || ARRAY['email_dedup_v320']
  FROM ranked r
 WHERE c.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_contacts_email_lower
  ON bi_contacts (LOWER(TRIM(email)))
  WHERE email IS NOT NULL AND TRIM(email) <> '';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bi_activity' AND column_name='contact_id') THEN
    ALTER TABLE bi_activity ADD COLUMN contact_id UUID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bi_activity_contact_id
  ON bi_activity(contact_id) WHERE contact_id IS NOT NULL;

UPDATE bi_activity a
   SET contact_id = c.id
  FROM bi_applications app
  JOIN bi_contacts c ON c.phone_e164 = app.guarantor_phone
 WHERE a.application_id = app.id
   AND a.contact_id IS NULL
   AND app.guarantor_phone IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bi_applications' AND column_name='company_id') THEN
    ALTER TABLE bi_applications ADD COLUMN company_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bi_companies' AND column_name='legal_name') THEN
    ALTER TABLE bi_companies ADD COLUMN legal_name TEXT;
  END IF;
  -- Fresh-replay guard: bi_companies may pre-exist without these timestamp columns.
  ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_companies_legal_name_lower
  ON bi_companies (LOWER(TRIM(legal_name)))
  WHERE legal_name IS NOT NULL AND TRIM(legal_name) <> '';

INSERT INTO bi_companies (id, legal_name, created_at, updated_at)
SELECT gen_random_uuid(), TRIM(a.company_name), MIN(a.created_at), NOW()
  FROM bi_applications a
 WHERE a.company_name IS NOT NULL AND TRIM(a.company_name) <> ''
   AND a.company_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM bi_companies bc
      WHERE LOWER(TRIM(bc.legal_name)) = LOWER(TRIM(a.company_name))
   )
 GROUP BY TRIM(a.company_name)
ON CONFLICT DO NOTHING;

UPDATE bi_applications a
   SET company_id = bc.id
  FROM bi_companies bc
 WHERE a.company_id IS NULL
   AND a.company_name IS NOT NULL
   AND LOWER(TRIM(bc.legal_name)) = LOWER(TRIM(a.company_name));

UPDATE bi_contacts c
   SET full_name = sub.guarantor_name,
       email     = COALESCE(c.email, sub.guarantor_email)
  FROM (
    SELECT DISTINCT ON (a.guarantor_phone)
           a.guarantor_phone,
           NULLIF(TRIM(a.guarantor_name), '')   AS guarantor_name,
           NULLIF(TRIM(a.guarantor_email), '')  AS guarantor_email
      FROM bi_applications a
     WHERE a.guarantor_phone IS NOT NULL
       AND NULLIF(TRIM(a.guarantor_name), '') IS NOT NULL
     ORDER BY a.guarantor_phone, a.created_at DESC
  ) sub
 WHERE c.phone_e164 = sub.guarantor_phone
   AND (c.full_name LIKE 'Applicant +%' OR c.full_name LIKE 'New applicant%' OR c.full_name IS NULL OR c.full_name = '');
