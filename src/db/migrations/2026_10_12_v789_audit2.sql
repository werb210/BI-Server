-- BI_SERVER_v789_AUDIT2 - new tables for audit round 2. Idempotent.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- [57] Lender application create honours Idempotency-Key. A repeat of the
-- same (lender, key, route) returns the stored response without creating or
-- submitting again.
CREATE TABLE IF NOT EXISTS bi_idempotency_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_id   UUID NOT NULL,
  idem_key    TEXT NOT NULL,
  route       TEXT NOT NULL,
  response    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lender_id, idem_key, route)
);
CREATE INDEX IF NOT EXISTS idx_bi_idempotency_keys_created_at ON bi_idempotency_keys (created_at);

-- [91] Staff notes on an application.
CREATE TABLE IF NOT EXISTS bi_application_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES bi_applications(id) ON DELETE CASCADE,
  author_id       TEXT,
  author_name     TEXT,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bi_application_notes_app_created
  ON bi_application_notes (application_id, created_at DESC);

-- Carry existing (non-deleted) bi_notes rows over so the notes tab keeps them.
INSERT INTO bi_application_notes (id, application_id, author_id, author_name, body, created_at)
SELECT n.id, n.application_id, n.owner_user_id::text, sp.full_name, n.body, n.created_at
  FROM bi_notes n
  JOIN bi_applications a ON a.id = n.application_id
  LEFT JOIN bi_staff_profile sp ON sp.staff_user_id = n.owner_user_id::text
 WHERE n.is_deleted = FALSE
   AND NOT EXISTS (SELECT 1 FROM bi_application_notes x WHERE x.id = n.id);

-- [89] Company-level activity, same shape as bi_contact_activity.
CREATE TABLE IF NOT EXISTS bi_company_activity (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES bi_companies(id) ON DELETE CASCADE,
  actor_id     TEXT,
  actor_name   TEXT,
  event_type   TEXT NOT NULL,
  outcome      TEXT,
  body         TEXT,
  meta         JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bi_company_activity_company_occurred
  ON bi_company_activity (company_id, occurred_at DESC);
