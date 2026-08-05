-- BI_SERVER_TEMPLATE_FIELDS_ROUNDTRIP_v9
-- The BI silo mounts the same BrandedEmailComposer as BF, so it had the same
-- defect: bi_email_templates kept only subject/body_text/body_html and dropped
-- every headline, image, image link and button on both columns.
ALTER TABLE bi_email_templates ADD COLUMN IF NOT EXISTS fields jsonb;
