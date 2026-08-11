-- BI_CONTRACT_SCHEDULE_AWARE_v29
-- The EllisDon subcontract demands workers' compensation (20.2, 35.1) and
-- automobile liability (35.4). Add labels so both can reach the applicant or
-- become a referral.
INSERT INTO bi_coverage_labels (coverage_code, display_name) VALUES
  ('workers_comp','Workers Compensation'),
  ('auto_liability','Automobile Liability')
ON CONFLICT (coverage_code) DO UPDATE
  SET display_name = EXCLUDED.display_name, updated_at = NOW();
