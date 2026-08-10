-- BI_SBA_QUESTION_v28
-- v27 dropped the CSBFP question for US applicants because the Canada Small
-- Business Financing Program does not exist there, but left nothing in its
-- place. A government-backed loan changes the guarantee position in both
-- countries, so the US needs its own version of the question rather than none.
-- Runs after 20260810_bi_pgi_application_fields.sql by filename order.

INSERT INTO bi_questions
(question_key, prompt, help_text, input_type, group_key, required) VALUES
('sba_backed','Is the loan backed by the U.S. Small Business Administration?',
'For example a 7(a) or 504 loan.','yes_no','loan',TRUE)
ON CONFLICT (question_key) DO UPDATE
SET prompt = EXCLUDED.prompt, help_text = EXCLUDED.help_text,
input_type = EXCLUDED.input_type, group_key = EXCLUDED.group_key,
required = EXCLUDED.required, updated_at = NOW();

-- Same slot CSBFP occupies for Canada, so the two sit in the same place in the
-- flow and neither country sees the other's programme.
INSERT INTO bi_coverage_questions (coverage_code, question_key, country, sort_order)
VALUES ('pgi','sba_backed','US',380)
ON CONFLICT (coverage_code, question_key, country) DO UPDATE
SET sort_order = EXCLUDED.sort_order;

DELETE FROM bi_coverage_questions
WHERE coverage_code = 'pgi' AND question_key = 'sba_backed' AND country = 'CA';
