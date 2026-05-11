-- BI_SERVER_BLOCK_v212_SUBMIT_GUARDS_v1
-- Relax bi_applications_entity_type_check so public + lender application
-- writes with entity_type='applicant' stop failing with 23514.
DO $$
DECLARE current_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO current_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE c.conname = 'bi_applications_entity_type_check'
    AND t.relname = 'bi_applications';

  IF current_def IS NOT NULL AND position('applicant' in current_def) = 0 THEN
    ALTER TABLE bi_applications DROP CONSTRAINT bi_applications_entity_type_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'bi_applications_entity_type_check'
      AND t.relname = 'bi_applications'
  ) THEN
    ALTER TABLE bi_applications ADD CONSTRAINT bi_applications_entity_type_check
      CHECK (entity_type IS NULL OR entity_type IN (
        'applicant', 'borrower', 'co_borrower', 'guarantor', 'co_guarantor',
        'principal', 'contact', 'individual', 'business', 'company'
      ));
  END IF;
END $$;
