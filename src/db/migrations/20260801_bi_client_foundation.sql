-- BI_CLIENT_FOUNDATION_v1
DO $$
BEGIN
  ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'subcontract_agreement';
  ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'certificate_of_insurance';
  ALTER TYPE bi_document_type ADD VALUE IF NOT EXISTS 'carrier_application';
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS bi_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL,
  display_name TEXT NOT NULL, carrier TEXT NOT NULL,
  country TEXT NOT NULL CHECK (country IN ('CA','US')),
  coverage_category TEXT NOT NULL, industry TEXT NOT NULL DEFAULT 'construction',
  tier INTEGER, instant_bind BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (code, country)
);
CREATE INDEX IF NOT EXISTS idx_bi_products_lookup ON bi_products (country, industry, active);

CREATE TABLE IF NOT EXISTS bi_application_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), application_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES bi_products(id),
  source TEXT NOT NULL DEFAULT 'contract' CHECK (source IN ('contract','recommended','client_added')),
  stage TEXT NOT NULL DEFAULT 'selected', carrier TEXT, premium NUMERIC(12,2),
  policy_id UUID, decline_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (application_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_bi_application_products_app ON bi_application_products (application_id);

CREATE TABLE IF NOT EXISTS bi_contract_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), application_id UUID NOT NULL,
  document_id UUID, coverage_code TEXT NOT NULL, extracted_limit NUMERIC(14,2),
  limit_basis TEXT, clause_text TEXT NOT NULL DEFAULT '',
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0, confirmed_by_client BOOLEAN,
  confirmed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_contract_requirements_app ON bi_contract_requirements (application_id);

INSERT INTO bi_products (code, display_name, carrier, country, coverage_category, tier, instant_bind, description, sort_order) VALUES
('cgl','Commercial General Liability','Markel Canada','CA','liability',1,TRUE,'Third-party injury or property damage on site.',10),
('cgl','Commercial General Liability','Markel US','US','liability',1,TRUE,'Third-party injury or property damage on site.',10),
('contractor_equipment','Contractors Equipment (Inland Marine)','Markel US','US','property',1,TRUE,'Theft or damage to tools and plant.',20),
('surety_bid','Contract Surety - Bid Bond','Allianz Trade','CA','surety',1,FALSE,'CCDC 220. Guarantees you will enter the contract if awarded.',30),
('surety_bid','Contract Surety - Bid Bond','Markel Surety','US','surety',1,TRUE,'AIA A310. Instant issuance available.',30),
('surety_performance','Contract Surety - Performance Bond','Allianz Trade','CA','surety',1,FALSE,'CCDC 221. Guarantees completion of the work.',31),
('surety_performance','Contract Surety - Performance Bond','Markel Surety','US','surety',1,TRUE,'AIA A312. Miller Act applies to federal work over $150,000.',31),
('surety_payment','Contract Surety - Labour and Material Payment Bond','Allianz Trade','CA','surety',1,FALSE,'CCDC 222. Guarantees your subcontractors and suppliers are paid.',32),
('surety_payment','Contract Surety - Labour and Material Payment Bond','Markel Surety','US','surety',1,TRUE,'AIA A312 payment bond.',32),
('surety_maintenance','Contract Surety - Maintenance Bond','Allianz Trade','CA','surety',1,FALSE,'Covers defects during the warranty period.',33),
('do','Management Liability (D&O)','CFC','CA','financial_lines',2,TRUE,'Claims against the individuals running the company.',40),
('do','Management Liability (D&O)','CFC','US','financial_lines',2,TRUE,'Claims against the individuals running the company.',40),
('eo','Contractor E&O','CFC','CA','professional',2,TRUE,'Errors and omissions, with cyber, pollution and rectification cost cover. From $500.',50),
('eo','E&O for Design and Construction Contractors','CFC','US','professional',2,TRUE,'Errors and omissions for US design-build contractors.',50),
('cpl','Contractors Pollution Liability','Markel Canada','CA','environmental',2,TRUE,'Picks up where CGL leaves off: mould, asbestos, fuel spills. Capacity to $25M.',60),
('cpl','Contractors Pollution Liability','Markel US','US','environmental',2,TRUE,'Picks up where CGL leaves off: mould, asbestos, fuel spills.',60),
('pgi','Personal Guarantee Insurance','Boreal','CA','specialty',2,TRUE,'Covers enforcement of a personal guarantee or indemnity you have signed.',70),
('pgi','Personal Guarantee Insurance','Boreal','US','specialty',2,TRUE,'Covers enforcement of a personal guarantee or indemnity you have signed.',70),
('cyber','Cyber','CFC','CA','cyber',2,TRUE,'Wire transfer fraud, ransomware, supply chain interruption.',80),
('cyber','Cyber','CFC','US','cyber',2,TRUE,'Wire transfer fraud, ransomware, supply chain interruption.',80),
('builders_risk','Large Builders Risk','Markel US','US','property',2,FALSE,'Course of construction physical damage and business interruption.',90),
('transactional','Transaction Liability','CFC','CA','specialty',3,FALSE,'Breach of reps and warranties on a sale. Offer and acceptance.',100),
('transactional','Transaction Liability','CFC','US','specialty',3,FALSE,'Breach of reps and warranties on a sale. Offer and acceptance.',100),
('trade_credit','Trade Credit Insurance','Allianz Trade','CA','credit',3,FALSE,'Protects receivables against customer insolvency.',110),
('trade_credit','Trade Credit Insurance','Allianz Trade','US','credit',3,FALSE,'Protects receivables against customer insolvency.',110)
ON CONFLICT (code, country) DO NOTHING;
