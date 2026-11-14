-- BI_SERVER_FIELD_AUDIENCE_v1 - whether a rep's contact is a lender or a broker, so the information email and the
-- follow-up text link to the page written for them.
ALTER TABLE bi_field_contacts ADD COLUMN IF NOT EXISTS audience text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bi_field_contacts_audience_check') THEN
    ALTER TABLE bi_field_contacts ADD CONSTRAINT bi_field_contacts_audience_check CHECK (audience IS NULL OR audience IN ('lender', 'broker'));
  END IF;
END $$;
