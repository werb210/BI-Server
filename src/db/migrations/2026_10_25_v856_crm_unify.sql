-- BI_SERVER_v856_CRM_UNIFY - the BI CRM gets the same shared CRM as BF, SLF and KS (BF-Server v856).
-- 1. bi_norm_tag()/bi_norm_tags() (same rules as BF-Server's bf_norm_tag and src/services/crmUnify/tags.ts) and a
--    one-off normalisation of stored tags (case, spaces, duplicates, "Contact form" -> contact_form).
-- 2. Extra staff tags an Admin adds for BI (bi_crm_tag_definitions).
-- 3. Company details the company panel edits (country, entity type, start date, time in business, employees,
--    annual revenue, domain) - empty ones fall back to the latest application.
-- 4. People added to a company by hand with a role (bi_crm_company_people) and people hidden from a company.
-- 5. Duplicate dismissals, the company merge log, data clean-up batches with before-images, cached AI summaries with
--    their sources, and an audit log of these staff actions (bi_crm_audit).
-- 6. Company repair: a contact with no company gets the company of its application.
-- Safe to run more than once.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION bi_norm_tag(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS
$FN$
  SELECT CASE x
           WHEN 'contactform' THEN 'contact_form'
           WHEN 'contact_us' THEN 'contact_form'
           WHEN 'website_contact_form' THEN 'contact_form'
           WHEN 'lenders' THEN 'lender'
           WHEN 'brokers' THEN 'broker'
           WHEN 'lawyers' THEN 'lawyer'
           WHEN 'attorney' THEN 'lawyer'
           WHEN 'referrers' THEN 'referrer'
           WHEN 'bookkeeper' THEN 'accountant'
           WHEN 'book_keeper' THEN 'accountant'
           WHEN 'accountants' THEN 'accountant'
           WHEN 'accountant_bookkeeper' THEN 'accountant'
           WHEN 'account_book_keeper' THEN 'accountant'
           WHEN 'accountant_book_keeper' THEN 'accountant'
           WHEN 'accountant_advisor' THEN 'accountant'
           WHEN 'cpa' THEN 'accountant'
           WHEN 'lawyer_advisor' THEN 'lawyer'
           WHEN 'attorney_advisor' THEN 'lawyer'
           WHEN 'insurance_advisor' THEN 'insurance'
           WHEN 'a_r_credit_insurance_advisor' THEN 'ar_credit_insurance'
           WHEN 'a_r_credit_insurance' THEN 'ar_credit_insurance'
           WHEN 'ar_credit_insurance_advisor' THEN 'ar_credit_insurance'
           WHEN 'accounts_receivable_credit_insurance' THEN 'ar_credit_insurance'
           WHEN 'booked_a_call' THEN 'booked_call'
           WHEN 'application_start' THEN 'application_started'
           WHEN 'credit_readiness_check' THEN 'credit_readiness'
           ELSE x
         END
    FROM (SELECT btrim(regexp_replace(regexp_replace(regexp_replace(lower(btrim(coalesce(t, ''))),
                 '[[:space:]/-]+', '_', 'g'), '[^a-z0-9_:]', '', 'g'), '_+', '_', 'g'), '_') AS x) s
$FN$;

CREATE OR REPLACE FUNCTION bi_norm_tags(tags text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE AS
$FN$
  SELECT coalesce(array_agg(n ORDER BY n), '{}'::text[])
    FROM (SELECT DISTINCT bi_norm_tag(t) AS n FROM unnest(coalesce(tags, '{}'::text[])) AS t) x
   WHERE n <> ''
$FN$;

UPDATE bi_contacts SET tags = bi_norm_tags(tags) WHERE tags IS DISTINCT FROM bi_norm_tags(tags);
UPDATE bi_companies SET tags = bi_norm_tags(tags) WHERE tags IS DISTINCT FROM bi_norm_tags(tags);

ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS time_in_business text;
ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS employees integer;
ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS annual_revenue numeric(18,2);
ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS domain text;

CREATE TABLE IF NOT EXISTS bi_crm_tag_definitions (
  slug        text PRIMARY KEY,
  label       text NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bi_crm_company_people (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES bi_companies(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES bi_contacts(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'other',
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bi_crm_company_people_role_check CHECK (role IN ('primary_applicant', 'partner', 'guarantor', 'accountant',
    'lawyer', 'bookkeeper', 'advisor', 'employee', 'other'))
);
CREATE UNIQUE INDEX IF NOT EXISTS bi_crm_company_people_uniq ON bi_crm_company_people (company_id, contact_id);
CREATE INDEX IF NOT EXISTS bi_crm_company_people_contact_idx ON bi_crm_company_people (contact_id);

CREATE TABLE IF NOT EXISTS bi_crm_company_people_hidden (
  company_id  uuid NOT NULL REFERENCES bi_companies(id) ON DELETE CASCADE,
  person_key  text NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, person_key)
);

CREATE TABLE IF NOT EXISTS bi_crm_duplicate_dismissals (
  entity      text NOT NULL CHECK (entity IN ('contact', 'company')),
  a_id        uuid NOT NULL,
  b_id        uuid NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, a_id, b_id)
);

CREATE TABLE IF NOT EXISTS bi_company_merges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_id     uuid NOT NULL,
  loser_id        uuid NOT NULL,
  moved           jsonb NOT NULL DEFAULT '{}'::jsonb,
  loser_snapshot  jsonb,
  merged_by       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bi_crm_cleanup_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  change_count  integer NOT NULL DEFAULT 0,
  undone_at     timestamptz,
  undone_by     text
);

CREATE TABLE IF NOT EXISTS bi_crm_cleanup_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid NOT NULL REFERENCES bi_crm_cleanup_batches(id) ON DELETE CASCADE,
  entity        text NOT NULL CHECK (entity IN ('contact', 'company')),
  entity_id     uuid NOT NULL,
  field         text NOT NULL,
  before_value  text,
  after_value   text,
  reason        text
);
CREATE INDEX IF NOT EXISTS bi_crm_cleanup_changes_batch_idx ON bi_crm_cleanup_changes (batch_id);

CREATE TABLE IF NOT EXISTS bi_crm_ai_summaries (
  entity        text NOT NULL CHECK (entity IN ('contact', 'company')),
  entity_id     uuid NOT NULL,
  summary       text NOT NULL,
  business      text,
  sources       jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  generated_by  text,
  PRIMARY KEY (entity, entity_id)
);

CREATE TABLE IF NOT EXISTS bi_crm_web_profiles (
  domain      text PRIMARY KEY,
  summary     text,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bi_crm_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text NOT NULL,
  actor_id    text,
  actor_name  text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bi_crm_audit_entity_idx ON bi_crm_audit (entity, entity_id, created_at DESC);

-- Company repair: the applicant's contact gets the company of its latest application.
UPDATE bi_contacts c
   SET company_id = x.company_id, updated_at = now()
  FROM (SELECT DISTINCT ON (a.primary_contact_id) a.primary_contact_id, a.company_id
          FROM bi_applications a
          JOIN bi_companies co ON co.id = a.company_id
         WHERE a.primary_contact_id IS NOT NULL AND a.company_id IS NOT NULL
         ORDER BY a.primary_contact_id, a.updated_at DESC NULLS LAST) x
 WHERE c.id = x.primary_contact_id AND c.company_id IS NULL AND c.converted_to_company_id IS NULL;

-- People linked from applications: the advisor / director detail and where the link came from; one-time jobs that
-- run from code (the director / partner / guarantor contact backfill) record themselves in bi_crm_backfill_runs.
ALTER TABLE bi_crm_company_people ADD COLUMN IF NOT EXISTS detail text;
ALTER TABLE bi_crm_company_people ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff';

CREATE TABLE IF NOT EXISTS bi_crm_backfill_runs (
  key         text PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result      jsonb
);

-- Roles: the applicant of a company's application is its Primary applicant (also on the company their own record
-- points at), never "Other".
INSERT INTO bi_crm_company_people (company_id, contact_id, role, source)
SELECT DISTINCT ON (x.company_id, x.contact_id) x.company_id, x.contact_id, 'primary_applicant', 'application'
  FROM (
    SELECT a.company_id, a.primary_contact_id AS contact_id, a.updated_at
      FROM bi_applications a
      JOIN bi_companies co ON co.id = a.company_id
      JOIN bi_contacts c ON c.id = a.primary_contact_id AND c.converted_to_company_id IS NULL
     WHERE a.company_id IS NOT NULL AND a.primary_contact_id IS NOT NULL
    UNION ALL
    SELECT c.company_id, a.primary_contact_id, a.updated_at
      FROM bi_applications a
      JOIN bi_contacts c ON c.id = a.primary_contact_id AND c.converted_to_company_id IS NULL
      JOIN bi_companies co ON co.id = c.company_id
  ) x
 ORDER BY x.company_id, x.contact_id, x.updated_at DESC NULLS LAST
ON CONFLICT (company_id, contact_id) DO UPDATE
   SET role = 'primary_applicant', source = 'application'
 WHERE bi_crm_company_people.role IN ('other', 'employee');
