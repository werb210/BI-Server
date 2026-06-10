-- BI_SERVER_BLOCK_v814 — the company importer stores a website per lender company.
ALTER TABLE bi_companies ADD COLUMN IF NOT EXISTS website TEXT;
