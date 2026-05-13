-- BI_SERVER_BLOCK_v253_APOLLO_PHASE1_SCAFFOLD_v1
-- Apollo enrichment cache + sequence enrollment ledger.
-- Three tables, all idempotent:
--   bi_apollo_enrichment        — last-known Apollo person data per contact
--   bi_apollo_sequence          — local mirror of Apollo sequences we care about
--   bi_apollo_enrollment        — which contact is in which sequence + lifecycle
-- raw_json columns hold full Apollo responses so we can extract
-- new fields later without re-fetching.

CREATE TABLE IF NOT EXISTS bi_apollo_enrichment (
  contact_id          UUID PRIMARY KEY REFERENCES bi_contacts(id) ON DELETE CASCADE,
  apollo_person_id    TEXT,
  email               TEXT,
  title               TEXT,
  linkedin_url        TEXT,
  company_name        TEXT,
  company_domain      TEXT,
  seniority           TEXT,
  raw_json            JSONB,
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source              TEXT NOT NULL DEFAULT 'apollo'
);
CREATE INDEX IF NOT EXISTS idx_bi_apollo_enrichment_email
  ON bi_apollo_enrichment(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bi_apollo_enrichment_fetched
  ON bi_apollo_enrichment(fetched_at DESC);

CREATE TABLE IF NOT EXISTS bi_apollo_sequence (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apollo_sequence_id  TEXT UNIQUE,
  name                TEXT NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  raw_json            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bi_apollo_enrollment (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID NOT NULL REFERENCES bi_contacts(id) ON DELETE CASCADE,
  sequence_id         UUID NOT NULL REFERENCES bi_apollo_sequence(id) ON DELETE CASCADE,
  apollo_contact_id   TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','active','paused','replied','bounced','completed','failed')),
  enrolled_by         TEXT,
  enrolled_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_event_at       TIMESTAMPTZ,
  last_event          TEXT,
  raw_json            JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_apollo_enrollment_contact_sequence
  ON bi_apollo_enrollment(contact_id, sequence_id);
CREATE INDEX IF NOT EXISTS idx_bi_apollo_enrollment_status
  ON bi_apollo_enrollment(status);
