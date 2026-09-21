-- BI_SEQ_EMAIL_TEMPLATE_AT_SEND_v373
-- Email steps saved with a template id but a blank subject or body get the
-- template's content. Idempotent: only touches steps that are still blank.
UPDATE bi_sequence_steps s
   SET subject = COALESCE(NULLIF(btrim(s.subject), ''), t.subject),
       body    = COALESCE(NULLIF(btrim(s.body), ''), t.body_html, t.body_text)
  FROM bi_email_templates t
 WHERE s.type = 'email'
   AND (NULLIF(btrim(s.subject), '') IS NULL OR NULLIF(btrim(s.body), '') IS NULL)
   AND s.conditions ? 'template_id'
   AND t.id::text = s.conditions->>'template_id';
