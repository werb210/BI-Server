-- BI_SERVER_BLOCK_v518 - v511 set andrew@boreal.financial, which does not exist
-- in Microsoft 365 (Graph ErrorInvalidUser). Replace it with andrew.p@. Idempotent.
UPDATE bi_sequences
   SET sender_rotation = array_replace(sender_rotation, 'andrew@boreal.financial', 'andrew.p@boreal.financial')
 WHERE 'andrew@boreal.financial' = ANY(sender_rotation);
