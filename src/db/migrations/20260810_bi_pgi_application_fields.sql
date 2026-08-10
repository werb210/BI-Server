-- BI_PGI_FIELDS_v27
-- The rest of BI-Website's PGI application, ahead of the disclosures.
-- Adds input metadata and seeds guarantor, business, and loan detail.
-- business_name, guarantor_name, guarantor_email, and guarantor_phone are
-- deliberately absent because step 1 already captures them.

-- Drop the old input_type CHECK by definition, since PostgreSQL chooses the
-- name of a column-level constraint.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'bi_questions'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%input_type%'
  LOOP
    EXECUTE format('ALTER TABLE bi_questions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE bi_questions ADD CONSTRAINT bi_questions_input_type_check
  CHECK (input_type IN ('yes_no','agree_disagree','text','textarea','number','date','select'));

ALTER TABLE bi_questions ADD COLUMN IF NOT EXISTS options     JSONB;
ALTER TABLE bi_questions ADD COLUMN IF NOT EXISTS min_value   NUMERIC(14,2);
ALTER TABLE bi_questions ADD COLUMN IF NOT EXISTS max_value   NUMERIC(14,2);
ALTER TABLE bi_questions ADD COLUMN IF NOT EXISTS placeholder TEXT;

INSERT INTO bi_questions
  (question_key, prompt, help_text, input_type, group_key, required, options, min_value, max_value, placeholder) VALUES
  ('guarantor_dob','What is your date of birth?',NULL,'date','guarantor',TRUE,NULL,NULL,NULL,NULL),
  ('guarantor_addr_line1','Primary residential address',NULL,'text','guarantor',TRUE,NULL,NULL,NULL,'123 King Street West'),
  ('guarantor_addr_city','City',NULL,'text','guarantor',TRUE,NULL,NULL,NULL,NULL),
  ('guarantor_addr_region','Province or state',NULL,'text','guarantor',TRUE,NULL,NULL,NULL,NULL),
  ('guarantor_addr_postal','Postal or ZIP code',NULL,'text','guarantor',TRUE,NULL,NULL,NULL,'A1A 1A1'),
  ('q_ca_id_type','Government ID type','As shown on your photo ID. Used for identity checks by the carrier.','select','guarantor',TRUE,
    '["Passport","National ID","Driving Licence","Other"]'::jsonb,NULL,NULL,NULL),
  ('q_ca_id_number','Government ID number','The number on that document.','text','guarantor',TRUE,NULL,NULL,NULL,'Exactly as shown on the document'),
  ('has_co_guarantors','Is anyone else guaranteeing this loan with you?','If yes, we will collect their details with you directly.','yes_no','guarantor',TRUE,NULL,NULL,NULL,NULL),
  ('entity_type','What type of entity is the business?',NULL,'select','business',TRUE,
    '["Corporation","Partnership","Sole Proprietorship","LLC","Other"]'::jsonb,NULL,NULL,NULL),
  ('business_addr_line1','Business operating address',NULL,'text','business',TRUE,NULL,NULL,NULL,'123 King Street West'),
  ('business_addr_city','Business city',NULL,'text','business',TRUE,NULL,NULL,NULL,NULL),
  ('business_addr_region','Business province or state','Quebec is not eligible for this coverage.','text','business',TRUE,NULL,NULL,NULL,NULL),
  ('business_addr_postal','Business postal or ZIP code',NULL,'text','business',TRUE,NULL,NULL,NULL,'A1A 1A1'),
  ('business_number','Business number',NULL,'text','business',FALSE,NULL,NULL,NULL,'123456789RT0001'),
  ('business_website','Business website',NULL,'text','business',FALSE,NULL,NULL,NULL,'optional'),
  ('lender_name','Who is the lender?',NULL,'text','loan',TRUE,NULL,NULL,NULL,NULL),
  ('q_ca_loan_type','What type of loan is this?','Only commercial mortgages and other secured loans are eligible.','select','loan',TRUE,
    '["Commercial Mortgage","Other Secured Loan"]'::jsonb,NULL,NULL,NULL),
  ('loan_amount','How much is the loan?','Between $50,000 and $1,000,000.','number','loan',TRUE,NULL,50000,1000000,NULL),
  ('pgi_limit','How much cover do you need?','Cannot be more than 80% of the loan amount.','number','loan',TRUE,NULL,NULL,1000000,NULL),
  ('loan_funding_date','What is the loan funding date?',NULL,'date','loan',TRUE,NULL,NULL,NULL,NULL),
  ('policy_start_date','What date do you need the policy to start?',NULL,'date','loan',TRUE,NULL,NULL,NULL,NULL),
  ('loan_purpose','What is the purpose of the loan?','For our records. It does not affect eligibility.','select','loan',TRUE,
    '["Working Capital","Acquisition","Expansion","Equipment Purchase","Real Estate","Refinance","Other"]'::jsonb,NULL,NULL,NULL),
  ('csbfp_backed','Is the loan backed by the Canada Small Business Financing Program?',NULL,'yes_no','loan',TRUE,NULL,NULL,NULL,NULL),
  ('loan_has_guaranteed_cap','Does the guarantee have a capped amount?',NULL,'yes_no','loan',TRUE,NULL,NULL,NULL,NULL),
  ('personally_guaranteeing','Are you personally guaranteeing this loan?',NULL,'yes_no','loan',TRUE,NULL,NULL,NULL,NULL)
ON CONFLICT (question_key) DO UPDATE
  SET prompt = EXCLUDED.prompt, help_text = EXCLUDED.help_text, input_type = EXCLUDED.input_type,
      group_key = EXCLUDED.group_key, required = EXCLUDED.required, options = EXCLUDED.options,
      min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
      placeholder = EXCLUDED.placeholder, updated_at = NOW();

UPDATE bi_coverage_questions SET sort_order = sort_order + 1000
 WHERE coverage_code = 'pgi' AND sort_order < 1000
   AND question_key IN (SELECT question_key FROM bi_questions WHERE group_key IN ('declarations','consents'));

INSERT INTO bi_coverage_questions (coverage_code, question_key, country, sort_order)
SELECT 'pgi', q.question_key, c.country, q.ord
  FROM (VALUES
    ('guarantor_dob',110),('guarantor_addr_line1',120),('guarantor_addr_city',130),
    ('guarantor_addr_region',140),('guarantor_addr_postal',150),
    ('q_ca_id_type',160),('q_ca_id_number',170),('has_co_guarantors',180),
    ('entity_type',210),('business_addr_line1',220),('business_addr_city',230),
    ('business_addr_region',240),('business_addr_postal',250),
    ('business_number',260),('business_website',270),
    ('lender_name',310),('q_ca_loan_type',320),('loan_amount',330),('pgi_limit',340),
    ('loan_funding_date',350),('policy_start_date',360),('loan_purpose',370),
    ('csbfp_backed',380),('loan_has_guaranteed_cap',390),('personally_guaranteeing',400)
  ) AS q(question_key, ord)
  CROSS JOIN (VALUES ('CA'),('US')) AS c(country)
ON CONFLICT (coverage_code, question_key, country) DO UPDATE
  SET sort_order = EXCLUDED.sort_order;

DELETE FROM bi_coverage_questions
 WHERE coverage_code = 'pgi' AND question_key = 'csbfp_backed' AND country = 'US';
