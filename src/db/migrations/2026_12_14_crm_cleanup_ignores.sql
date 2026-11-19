-- BI_SERVER_CLEANUP_IGNORE_v1 - "Clean up data": a proposed change staff choose to ignore stays ignored (same as
-- BF-Server's crm_cleanup_ignores). Idempotent.
CREATE TABLE IF NOT EXISTS bi_crm_cleanup_ignores (
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  field text NOT NULL,
  after_value text NOT NULL,
  before_value text,
  ignored_by text,
  ignored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, entity_id, field, after_value)
);
