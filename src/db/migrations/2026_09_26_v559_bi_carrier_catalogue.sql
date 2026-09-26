-- BI_SERVER_BLOCK_v559_CARRIER_CATALOGUE
-- Source: Product Catalogue by Country and Industry. Carrier names are staff-only, verified=FALSE until confirmed.
CREATE TABLE IF NOT EXISTS bi_carrier_products (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), coverage_code TEXT NOT NULL, country TEXT NOT NULL CHECK (country IN ('CA','US')),
 carrier TEXT NOT NULL, product_name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', instant_bind BOOLEAN NOT NULL DEFAULT FALSE,
 submission_email TEXT, submission_url TEXT, verified BOOLEAN NOT NULL DEFAULT FALSE, active BOOLEAN NOT NULL DEFAULT TRUE,
 sort_order INTEGER NOT NULL DEFAULT 100, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE (coverage_code, country, carrier)
);
CREATE TABLE IF NOT EXISTS bi_carrier_submissions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), application_id UUID NOT NULL, application_product_id UUID NOT NULL,
 carrier_product_id UUID NOT NULL REFERENCES bi_carrier_products(id), carrier TEXT NOT NULL,
 method TEXT NOT NULL CHECK (method IN ('email','portal')), sent_to TEXT, note TEXT, sent_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bi_carrier_submissions_app ON bi_carrier_submissions (application_id, created_at DESC);
-- New lines: inactive for clients until verified; staff can route them now.
INSERT INTO bi_products (code, display_name, carrier, country, coverage_category, tier, instant_bind, description, sort_order, active) VALUES
('ppl','Site / Premises Pollution Liability','Markel Canada','CA','environmental',2,FALSE,'Pollution from a site you own or operate, including storage tanks.',61,FALSE),
('ppl','Site / Premises Pollution Liability','Markel US','US','environmental',2,FALSE,'Pollution from a site you own or operate.',61,FALSE),
('umbrella','Umbrella and Excess Liability','Markel Canada','CA','liability',2,FALSE,'Extra limits over your primary liability policies.',15,FALSE),
('umbrella','Umbrella and Excess Liability','Markel US','US','liability',2,FALSE,'Extra limits over your primary liability policies.',15,FALSE),
('property_package','Property and Casualty Package','Markel Canada','CA','property',2,FALSE,'Property, liability, business interruption and contents in one policy.',25,FALSE),
('property_package','Property and Casualty Package','Markel US','US','property',2,FALSE,'Property and liability for small businesses.',25,FALSE),
('product_recall','Product Recall','CFC','CA','specialty',3,FALSE,'Costs of recalling a contaminated or defective product.',105,FALSE),
('product_recall','Product Recall','CFC','US','specialty',3,FALSE,'Costs of recalling a contaminated or defective product.',105,FALSE),
('commercial_surety','Commercial Surety - Licence and Permit Bonds','Allianz Trade','CA','surety',2,FALSE,'Bonds required to hold a licence or permit.',34,FALSE),
('commercial_surety','Commercial Surety - Licence and Permit Bonds','Markel Surety','US','surety',2,TRUE,'Bonds required to hold a licence or permit.',34,FALSE)
ON CONFLICT (code, country) DO NOTHING;
INSERT INTO bi_industries (code, display_name, naics_code, wants_contract, sort_order) VALUES
('financial','Financial institutions and fintech','522390',FALSE,65),('energy','Energy, oil and gas','213112',FALSE,75),
('transportation','Transportation, logistics and marine','488510',FALSE,85) ON CONFLICT (code) DO NOTHING;
INSERT INTO bi_industry_coverages (industry_code, coverage_code, sort_order) VALUES
('financial','pgi',5),('financial','eo',10),('financial','do',20),('financial','cyber',30),('financial','transactional',40),
('energy','pgi',5),('energy','cgl',10),('energy','cpl',20),('energy','eo',30),('energy','do',40),
('transportation','pgi',5),('transportation','trade_credit',10),('transportation','cgl',20),('transportation','cyber',30),('transportation','do',40)
ON CONFLICT (industry_code, coverage_code) DO NOTHING;
INSERT INTO bi_carrier_products (coverage_code, country, carrier, product_name, notes, instant_bind, sort_order) VALUES
('cgl','CA','Markel Canada','Commercial General Liability','Occurrence or claims-made. Limited pollution (120hr), non-owned auto.',FALSE,10),
('surety_bid','CA','Allianz Trade','Contract Surety - Bid Bond','CCDC 220. Broker submission, not instant.',FALSE,10),
('surety_performance','CA','Allianz Trade','Contract Surety - Performance Bond','CCDC 221.',FALSE,10),
('surety_payment','CA','Allianz Trade','Contract Surety - Labour & Material Payment Bond','CCDC 222.',FALSE,10),
('surety_maintenance','CA','Allianz Trade','Contract Surety - Maintenance Bond','Warranty-period defects.',FALSE,10),
('commercial_surety','CA','Allianz Trade','Commercial Surety - Licence and Permit Bonds','Regulated trades.',FALSE,10),
('do','CA','CFC','Management Liability (D&O)','D&O + EPL + crime + executive reputation.',TRUE,10),
('do','CA','Markel Canada','Management Liability (D&O)','',FALSE,20),
('eo','CA','CFC','Contractor E&O','E&O + cyber + pollution + professional, with rectification cost cover. From $500.',TRUE,10),
('eo','CA','Markel Canada','Professional Liability (E&O)','Claims-made. Architects, engineers, design-build.',FALSE,20),
('cpl','CA','Markel Canada','Contractors Pollution Liability (CPL)','Capacity to $25M, min premium $1,000. CPL Portal binds online.',TRUE,10),
('cpl','CA','CFC','Pollution Liability - Contractors','Standalone. Confirm wording with CFC.',FALSE,20),
('cpl','CA','TerrAssure','Contractors Pollution Liability','Canada only. Limits, paper and minimum premium unpublished.',FALSE,30),
('ppl','CA','Markel Canada','Premises Pollution Liability (PPL)','Includes storage tank liability.',FALSE,10),
('ppl','CA','CFC','Pollution Liability - Site','Standalone.',FALSE,20),('ppl','CA','TerrAssure','Site Pollution','Canada only.',FALSE,30),
('cyber','CA','CFC','Cyber','Connect portal and API partners.',TRUE,10),('cyber','CA','Markel Canada','Cyber 360 Canada','Flagship primary cyber.',FALSE,20),
('umbrella','CA','Markel Canada','Umbrella & Excess Liability','Over primary.',FALSE,10),
('property_package','CA','Markel Canada','Property & Casualty package','Property, liability, BI, contents, inland marine.',FALSE,10),
('property_package','CA','CFC','Property and Casualty','',FALSE,20),('product_recall','CA','CFC','Product Recall','Food and beverage, consumer goods, automotive.',FALSE,10),
('transactional','CA','CFC','Transaction Liability','Reps and warranties. Offer and acceptance, not instant.',FALSE,10),
('trade_credit','CA','Allianz Trade','Trade Credit Insurance','Simplicity, Medium & Large, Multinational. Up to 95% indemnity.',FALSE,10),
('cgl','US','Markel US','Primary Casualty - contractors and developers','Practice policy, project-specific, owners interest, OCP.',FALSE,10),
('contractor_equipment','US','Markel US','Contractors'' Equipment (inland marine)','Also misc. property floaters and motor truck cargo.',FALSE,10),
('surety_bid','US','Markel Surety','Contract Bonds','Capacity to $500M, all 50 states. Primes and subs.',TRUE,10),
('surety_bid','US','Allianz Trade','Contract Surety - Bid, Performance, Payment, Warranty','AIA A310/A312. Miller Act over $150,000.',FALSE,20),
('surety_performance','US','Markel Surety','Contract Bonds','Capacity to $500M.',TRUE,10),
('surety_performance','US','Allianz Trade','Contract Surety - Bid, Performance, Payment, Warranty','',FALSE,20),
('surety_payment','US','Markel Surety','Contract Bonds','',TRUE,10),('surety_payment','US','Allianz Trade','Contract Surety - Bid, Performance, Payment, Warranty','',FALSE,20),
('commercial_surety','US','Markel Surety','Commercial Bonds','Instant issuance on Surety Connect.',TRUE,10),
('commercial_surety','US','Allianz Trade','Commercial Surety','Licence and permit, court, compliance.',FALSE,20),
('do','US','CFC','Management Liability (D&O)','',TRUE,10),('eo','US','CFC','E&O for design and construction contractors','US wording, distinct from the Canadian Contractor E&O.',TRUE,10),
('cpl','US','Markel US','Environmental','Broad appetite.',FALSE,10),('cpl','US','CFC','Pollution Liability - Contractors / Site','',FALSE,20),
('ppl','US','Markel US','Environmental','',FALSE,10),('ppl','US','CFC','Pollution Liability - Contractors / Site','',FALSE,20),
('cyber','US','CFC','Cyber','Construction: wire transfer fraud, supply chain interruption.',TRUE,10),
('builders_risk','US','Markel US','Large Builders Risk','Project-specific and master programmes.',FALSE,10),
('umbrella','US','Markel US','Excess and Umbrella','',FALSE,10),('property_package','US','Markel US','Small Business Casualty and Property','Contractor bundles.',FALSE,10),
('product_recall','US','CFC','Product Recall','',FALSE,10),('transactional','US','CFC','Transaction Liability','Offer and acceptance.',FALSE,10),
('trade_credit','US','Allianz Trade','Trade Credit Insurance','',FALSE,10)
ON CONFLICT (coverage_code, country, carrier) DO NOTHING;
