-- BI_SERVER_BLOCK_v719 - enrollments the old worker parked as 'active' with no next step never ran again.
-- On an active sequence they run now; otherwise they become paused, and Start revives them.
UPDATE bi_sequence_enrollments e
   SET next_step_at = NOW()
  FROM bi_sequences s
 WHERE s.id = e.sequence_id AND e.status = 'active' AND e.next_step_at IS NULL AND s.status = 'active';
UPDATE bi_sequence_enrollments
   SET status = 'paused', paused_reason = COALESCE(paused_reason, 'sequence_inactive')
 WHERE status = 'active' AND next_step_at IS NULL;
