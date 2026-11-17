-- BI_SERVER_EMAIL_FLOWS_v1 - an email flow: everyone gets a first email, and what each person does next (nothing,
-- opened, clicked) decides the next email. One row per flow, one row per person in it. Idempotent.
CREATE TABLE IF NOT EXISTS bi_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  preset text,
  audience text NOT NULL,
  market text NOT NULL DEFAULT 'ALL',
  status text NOT NULL DEFAULT 'draft',
  daily_new integer NOT NULL DEFAULT 100,
  from_name text,
  reply_to text,
  owner_user_id text,
  owner_name text,
  link_url text,
  booking_url text,
  emails jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bi_flows_status_check CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  CONSTRAINT bi_flows_audience_check CHECK (audience IN ('lender', 'broker')),
  CONSTRAINT bi_flows_market_check CHECK (market IN ('US', 'CA', 'ALL'))
);
CREATE TABLE IF NOT EXISTS bi_flow_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES bi_flows(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  track text NOT NULL DEFAULT 'none',
  sent_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  last_sent_at timestamptz,
  first_sent_at timestamptz,
  next_key text,
  next_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  task_created_at timestamptz,
  events_seen_at timestamptz NOT NULL DEFAULT now(),
  stop_reason text,
  failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bi_flow_members_status_check CHECK (status IN ('queued', 'active', 'done', 'stopped')),
  CONSTRAINT bi_flow_members_track_check CHECK (track IN ('none', 'opened', 'clicked'))
);
CREATE UNIQUE INDEX IF NOT EXISTS bi_flow_members_flow_contact_uq ON bi_flow_members (flow_id, contact_id);
CREATE INDEX IF NOT EXISTS bi_flow_members_due_idx ON bi_flow_members (next_at) WHERE status = 'active' AND next_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS bi_marketing_send_events_job_idx ON bi_marketing_send_events (job_id, created_at);
