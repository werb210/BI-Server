-- BI_SERVER_ENGAGEMENT_v1 (2026-11-27) - Todd: keep track of PGI marketing so nobody who answers slips through.
-- One row per contact the PGI email flows have reached: how far they have got (sent, opened, clicked, replied,
-- booked, met, signed up), the reply and what kind it is, who follows up and by when. The flows already hold sends,
-- opens, clicks and replies; this adds bookings, meetings, sign-ups and the follow-up queue on top. Idempotent.
CREATE TABLE IF NOT EXISTS bi_engagement (
  contact_id uuid PRIMARY KEY,
  flow_id uuid,
  stage text NOT NULL DEFAULT 'sent',
  stage_at timestamptz,
  sent_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  booked_at timestamptz,
  met_at timestamptz,
  signed_up_at timestamptz,
  lost_at timestamptz,
  lost_reason text,
  reply_kind text,
  reply_subject text,
  reply_snippet text,
  reply_mailbox text,
  meeting_at timestamptz,
  meeting_outcome text,
  owner_user_id text,
  owner_name text,
  follow_up_due_at timestamptz,
  follow_up_reason text,
  followed_up_at timestamptz,
  task_for timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bi_engagement_stage_idx ON bi_engagement (stage);
CREATE INDEX IF NOT EXISTS bi_engagement_due_idx ON bi_engagement (follow_up_due_at) WHERE follow_up_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS bi_engagement_flow_idx ON bi_engagement (flow_id);

CREATE TABLE IF NOT EXISTS bi_engagement_events (
  id bigserial PRIMARY KEY,
  contact_id uuid NOT NULL,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_name text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bi_engagement_events_contact_idx ON bi_engagement_events (contact_id, at DESC);

-- Who follows up. Empty = the flow's owner. Several people = round robin by who has the fewest open follow-ups.
CREATE TABLE IF NOT EXISTS bi_engagement_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
