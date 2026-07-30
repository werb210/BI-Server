-- BF users live in a separate database, so this intentionally has no foreign
-- key. BF-Server validates the identifier when the sequence task is created.
ALTER TABLE bi_sequence_steps
  ADD COLUMN IF NOT EXISTS assignee_user_id UUID;
