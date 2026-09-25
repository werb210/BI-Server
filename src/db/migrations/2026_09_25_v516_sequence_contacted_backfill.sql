-- BI_SERVER_BLOCK_v516_SEQUENCE_TOUCH_LOGGING - contacts that already received a
-- sequence email or SMS move from New to Contacted. Forward only; idempotent.
UPDATE bi_contacts c
   SET outreach_status = 'contacted', outreach_updated_at = NOW()
 WHERE COALESCE(c.outreach_status, 'new') IN ('new', 'cold', 'attempting', 'voicemail')
   AND EXISTS (
     SELECT 1
       FROM bi_sequence_events ev
       JOIN bi_sequence_enrollments e ON e.id = ev.enrollment_id
      WHERE e.contact_id = c.id
        AND ev.event_type = 'sent'
        AND ev.channel IN ('email', 'sms')
   );
