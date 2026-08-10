-- BI_QUESTION_BANK_v24
-- Questions are shared by key, mapped to coverages by country, and answered once per application.
CREATE TABLE IF NOT EXISTS bi_questions (
  question_key TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  help_text TEXT,
  input_type TEXT NOT NULL DEFAULT 'yes_no'
    CHECK (input_type IN ('yes_no','agree_disagree','text','textarea','number','date')),
  group_key TEXT NOT NULL DEFAULT 'general',
  adverse_answer TEXT,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  depends_on_key TEXT REFERENCES bi_questions(question_key) ON DELETE SET NULL,
  depends_on_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bi_coverage_questions (
  coverage_code TEXT NOT NULL,
  question_key TEXT NOT NULL REFERENCES bi_questions(question_key) ON DELETE CASCADE,
  country TEXT NOT NULL CHECK (country IN ('CA','US')),
  sort_order INTEGER NOT NULL DEFAULT 100,
  PRIMARY KEY (coverage_code, question_key, country)
);
CREATE INDEX IF NOT EXISTS idx_bi_covq_lookup ON bi_coverage_questions (coverage_code, country, sort_order);

CREATE TABLE IF NOT EXISTS bi_application_answers (
  application_id UUID NOT NULL REFERENCES bi_applications(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL REFERENCES bi_questions(question_key) ON DELETE CASCADE,
  value TEXT,
  reason TEXT,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (application_id, question_key)
);
CREATE INDEX IF NOT EXISTS idx_bi_answers_app ON bi_application_answers (application_id);

INSERT INTO bi_questions (question_key, prompt, input_type, group_key, adverse_answer, required) VALUES
  ('section_1_a','Does the business carry insurance coverage for all physical assets covered by the personal guarantee?','yes_no','declarations',NULL,TRUE),
  ('section_1_2','Have you ever declared personal bankruptcy?','yes_no','declarations','yes',TRUE),
  ('section_2_a','Have you ever been barred from serving as a Director, or are you currently under investigation that could result in being barred?','yes_no','declarations','yes',TRUE),
  ('section_2_b','Have you ever been a Director of a company that has gone through bankruptcy, receivership, or restructuring proceedings?','yes_no','declarations','yes',TRUE),
  ('section_2_c','Have you ever been a Director of a company that has been under investigation by the Canada Revenue Agency or the Canada Border Services Agency?','yes_no','declarations','yes',TRUE),
  ('section_2_c_us','Have you ever been a Director of a company that has been under investigation by the Internal Revenue Service or U.S. Customs and Border Protection?','yes_no','declarations','yes',TRUE),
  ('section_2_d','Do you currently have any actual or contingent liability that you will not be able to pay within 30 days of when it becomes due?','yes_no','declarations','yes',TRUE),
  ('section_3_a','Does the business currently have any bad or doubtful debts owed to it that are likely to materially affect its ability to pay liabilities as they become due?','yes_no','declarations','yes',TRUE),
  ('section_4_a','Has the business lost a significant investor, customer, or supplier in the last 6 months?','yes_no','declarations','yes',TRUE),
  ('section_5_a','Are you aware of any information that could materially affect the business''s ability to meet its obligations over the next 6 months?','yes_no','declarations','yes',TRUE),
  ('section_6_a','As of today, is the company solvent (able to pay its debts as they become due)?','yes_no','declarations',NULL,TRUE),
  ('section_3_c','I confirm that all answers above are true to the best of my knowledge. If anyone else completed this form on my behalf, I confirm they were authorized to do so and that their answers are accurate.','agree_disagree','declarations','Disagree',TRUE),
  ('electronic_signature','Do you consent to electronic signatures?','yes_no','consents',NULL,TRUE),
  ('no_undisclosed_events','Do you certify there are no undisclosed adverse events?','yes_no','consents',NULL,TRUE),
  ('data_use','Do you consent to our use of your data for underwriting?','yes_no','consents',NULL,TRUE),
  ('credit_pull','Do you authorize us to pull your credit report?','yes_no','consents',NULL,TRUE),
  ('coverage_understood','Do you understand what PGI covers and does not cover?','yes_no','consents',NULL,TRUE)
ON CONFLICT (question_key) DO UPDATE
SET prompt = EXCLUDED.prompt, input_type = EXCLUDED.input_type,
    group_key = EXCLUDED.group_key, adverse_answer = EXCLUDED.adverse_answer,
    updated_at = NOW();

INSERT INTO bi_coverage_questions (coverage_code, question_key, country, sort_order)
SELECT 'pgi', q.question_key, c.country, q.ord
FROM (VALUES
  ('section_1_a',10),('section_1_2',20),('section_2_a',30),('section_2_b',40),
  ('section_2_d',60),('section_3_a',70),('section_4_a',80),('section_5_a',90),
  ('section_6_a',100),('section_3_c',110),('electronic_signature',200),
  ('no_undisclosed_events',210),('data_use',220),('credit_pull',230),('coverage_understood',240)
) AS q(question_key, ord)
CROSS JOIN (VALUES ('CA'),('US')) AS c(country)
ON CONFLICT (coverage_code, question_key, country) DO NOTHING;

INSERT INTO bi_coverage_questions (coverage_code, question_key, country, sort_order) VALUES
  ('pgi','section_2_c','CA',50),
  ('pgi','section_2_c_us','US',50)
ON CONFLICT (coverage_code, question_key, country) DO NOTHING;
