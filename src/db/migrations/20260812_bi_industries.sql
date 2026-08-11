-- BI_INDUSTRY_ROUTING_v31
-- Coverage categories, deliberately, not unverified carrier product names.
CREATE TABLE IF NOT EXISTS bi_industries (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  naics_code TEXT NOT NULL,
  wants_contract BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO bi_industries (code, display_name, naics_code, wants_contract, sort_order) VALUES
  ('construction','Construction and trades','236220',TRUE,10),
  ('manufacturing','Manufacturing and distribution','332999',FALSE,20),
  ('technology','Technology, media and telecom','541510',FALSE,30),
  ('professional_services','Professional services','541611',FALSE,40),
  ('healthcare','Healthcare and life sciences','621111',FALSE,50),
  ('real_estate','Real estate and property','531120',FALSE,60),
  ('retail_food','Retail, wholesale, food and beverage','445110',FALSE,70),
  ('nonprofit','Non-profit, social and care','813410',FALSE,80),
  ('sport_recreation','Sport, recreation and fitness','713940',FALSE,90),
  ('other','Something else','561990',FALSE,999)
ON CONFLICT (code) DO UPDATE
SET display_name = EXCLUDED.display_name, naics_code = EXCLUDED.naics_code,
    wants_contract = EXCLUDED.wants_contract, sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS bi_industry_coverages (
  industry_code TEXT NOT NULL REFERENCES bi_industries(code) ON DELETE CASCADE,
  coverage_code TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  PRIMARY KEY (industry_code, coverage_code)
);

INSERT INTO bi_industry_coverages (industry_code, coverage_code, sort_order) VALUES
  ('manufacturing','pgi',5),('manufacturing','trade_credit',10),('manufacturing','cgl',20),
  ('manufacturing','eo',30),('manufacturing','cpl',40),('manufacturing','cyber',50),('manufacturing','do',60),
  ('technology','pgi',5),('technology','eo',10),('technology','cyber',20),('technology','do',30),
  ('professional_services','pgi',5),('professional_services','eo',10),('professional_services','cyber',20),
  ('professional_services','do',30),('professional_services','cgl',40),
  ('healthcare','pgi',5),('healthcare','eo',10),('healthcare','cyber',20),('healthcare','cgl',30),('healthcare','do',40),
  ('real_estate','pgi',5),('real_estate','cgl',10),('real_estate','cpl',20),('real_estate','do',30),('real_estate','cyber',40),
  ('retail_food','pgi',5),('retail_food','trade_credit',10),('retail_food','cgl',20),
  ('retail_food','cyber',30),('retail_food','do',40),
  ('nonprofit','pgi',5),('nonprofit','cgl',10),('nonprofit','do',20),('nonprofit','cyber',30),
  ('sport_recreation','pgi',5),('sport_recreation','cgl',10),('sport_recreation','do',20),
  ('other','pgi',5),('other','cgl',10),('other','eo',20),('other','cyber',30),('other','do',40)
ON CONFLICT (industry_code, coverage_code) DO UPDATE SET sort_order = EXCLUDED.sort_order;

INSERT INTO bi_questions
  (question_key, prompt, help_text, input_type, group_key, required, options, min_value, max_value, placeholder) VALUES
  ('formation_date','When was the business formed?','The date on your incorporation or registration record.','date','business',TRUE,NULL,NULL,NULL,NULL),
  ('naics_code','Industry code','We have filled this in from the industry you chose. Change it only if you know your own code.','text','business',FALSE,NULL,NULL,NULL,'6 digits')
ON CONFLICT (question_key) DO UPDATE
SET prompt = EXCLUDED.prompt, help_text = EXCLUDED.help_text, input_type = EXCLUDED.input_type,
    group_key = EXCLUDED.group_key, required = EXCLUDED.required, placeholder = EXCLUDED.placeholder,
    updated_at = NOW();

INSERT INTO bi_coverage_questions (coverage_code, country, question_key, sort_order)
SELECT 'pgi', c.country, k.question_key, k.sort_order
FROM (VALUES ('CA'),('US')) AS c(country),
     (VALUES ('formation_date',115),('naics_code',116)) AS k(question_key, sort_order)
ON CONFLICT DO NOTHING;
