-- BI_SERVER_BLOCK_v511_BI_SEQUENCE_SENDER - existing sequences with no sender
-- send from andrew@boreal.financial. Idempotent: only touches empty rotations.
UPDATE bi_sequences
   SET sender_rotation = ARRAY['andrew@boreal.financial']
 WHERE cardinality(sender_rotation) = 0;
