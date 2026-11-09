-- BI_SERVER_CUSTOM_FIELDS_v1 - custom fields on Insurance contacts and companies (same model as BF-Server v870).
CREATE TABLE IF NOT EXISTS bi_custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type text NOT NULL,
  name text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  group_name text,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bi_custom_field_definitions_object_check CHECK (object_type IN ('contact', 'company')),
  CONSTRAINT bi_custom_field_definitions_type_check CHECK (field_type IN
    ('text', 'long_text', 'number', 'money', 'date', 'single_select', 'multi_select', 'checkbox', 'url', 'email', 'phone')),
  CONSTRAINT bi_custom_field_definitions_name_check CHECK (name ~ '^[a-z][a-z0-9_]{0,62}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS bi_custom_field_definitions_name_uq ON bi_custom_field_definitions (object_type, name);
ALTER TABLE bi_contacts ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
