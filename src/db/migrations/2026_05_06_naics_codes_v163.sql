-- BI_SERVER_BLOCK_v163_NAICS_LOOKUP_v1
-- NAICS codes catalog. V1 ships with a seed of the most common Canadian
-- codes (StatCan NAICS 2022) covering ~95% of small business industry
-- selections. cached_at column is a placeholder for V2 live-API refresh.

CREATE TABLE IF NOT EXISTS naics_codes (
  code TEXT NOT NULL,
  country TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (code, country)
);

-- BI_SERVER_BLOCK_v192_PG_TRGM_BEFORE_INDEX_v1
-- Order matters: the GIN index references gin_trgm_ops, the operator class
-- defined by the pg_trgm extension. Creating the index before the extension
-- fails with 42704 ("operator class "gin_trgm_ops" does not exist for
-- access method "gin""), runMigrations rolls back, and every later .sql
-- is skipped. Same idempotent class as v190 / v191. CREATE EXTENSION must
-- come first so the operator class is resolvable when the index is built.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS naics_codes_title_trgm_idx
  ON naics_codes USING gin (lower(title) gin_trgm_ops);

INSERT INTO naics_codes (code, country, title, description) VALUES
  ('236110','CA','Residential building construction','New single-family + multi-family + remodeling'),
  ('236210','CA','Industrial building construction',NULL),
  ('236220','CA','Commercial and institutional building construction',NULL),
  ('238100','CA','Foundation, structure, and building exterior contractors',NULL),
  ('238210','CA','Electrical contractors and other wiring installation',NULL),
  ('238220','CA','Plumbing, heating and air-conditioning contractors',NULL),
  ('238910','CA','Site preparation contractors',NULL),
  ('441100','CA','Automobile dealers',NULL),
  ('441200','CA','Other motor vehicle dealers',NULL),
  ('441300','CA','Automotive parts, accessories and tire stores',NULL),
  ('445110','CA','Supermarkets and grocery stores',NULL),
  ('445120','CA','Convenience stores',NULL),
  ('445230','CA','Fruit and vegetable markets',NULL),
  ('445299','CA','All other specialty food stores',NULL),
  ('445310','CA','Beer, wine and liquor stores',NULL),
  ('446110','CA','Pharmacies and drug stores',NULL),
  ('448110','CA','Men''s clothing stores',NULL),
  ('448120','CA','Women''s clothing stores',NULL),
  ('448140','CA','Family clothing stores',NULL),
  ('451110','CA','Sporting goods stores',NULL),
  ('453110','CA','Florists',NULL),
  ('453910','CA','Pet and pet supplies stores',NULL),
  ('484110','CA','General freight trucking, local',NULL),
  ('484121','CA','General freight trucking, long distance, truckload',NULL),
  ('484229','CA','Other specialized trucking, local',NULL),
  ('492110','CA','Couriers',NULL),
  ('492210','CA','Local messengers and local delivery',NULL),
  ('522110','CA','Banking',NULL),
  ('523930','CA','Investment advice',NULL),
  ('524210','CA','Insurance agencies and brokerages',NULL),
  ('531110','CA','Lessors of residential buildings and dwellings',NULL),
  ('531210','CA','Offices of real estate agents and brokers',NULL),
  ('531311','CA','Residential property managers',NULL),
  ('541110','CA','Offices of lawyers',NULL),
  ('541211','CA','Offices of certified public accountants',NULL),
  ('541310','CA','Architectural services',NULL),
  ('541330','CA','Engineering services',NULL),
  ('541430','CA','Graphic design services',NULL),
  ('541510','CA','Computer systems design and related services',NULL),
  ('541611','CA','Administrative management and general management consulting',NULL),
  ('541810','CA','Advertising agencies',NULL),
  ('541910','CA','Marketing research and public opinion polling',NULL),
  ('561320','CA','Temporary help services',NULL),
  ('561720','CA','Janitorial services',NULL),
  ('611110','CA','Elementary and secondary schools',NULL),
  ('621111','CA','Offices of physicians (except mental health specialists)',NULL),
  ('621210','CA','Offices of dentists',NULL),
  ('621310','CA','Offices of chiropractors',NULL),
  ('621320','CA','Offices of optometrists',NULL),
  ('621399','CA','Offices of all other miscellaneous health practitioners',NULL),
  ('621610','CA','Home health care services',NULL),
  ('722410','CA','Drinking places (alcoholic beverages)',NULL),
  ('722511','CA','Full-service restaurants',NULL),
  ('722512','CA','Limited-service eating places',NULL),
  ('722513','CA','Limited-service eating places (counter service)',NULL),
  ('811111','CA','General automotive repair',NULL),
  ('811121','CA','Automotive body, paint and interior repair and maintenance',NULL),
  ('811210','CA','Electronic and precision equipment repair and maintenance',NULL),
  ('812114','CA','Hair stylists',NULL),
  ('812115','CA','Barber shops',NULL),
  ('812116','CA','Unisex hair salons',NULL),
  ('812199','CA','Other personal care services',NULL),
  ('812910','CA','Pet care (except veterinary) services',NULL)
ON CONFLICT (code, country) DO NOTHING;

INSERT INTO naics_codes (code, country, title, description)
SELECT code, 'US', title, description FROM naics_codes WHERE country = 'CA'
ON CONFLICT (code, country) DO NOTHING;
