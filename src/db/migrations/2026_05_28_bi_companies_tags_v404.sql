-- 2026_05_28_bi_companies_tags_v404.sql
-- bulk-tag on BI companies needs a tags column; base bi_companies has none.
ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
