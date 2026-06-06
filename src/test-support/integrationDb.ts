// BI_SERVER_BLOCK_v356_TEST_DB_HARNESS — integration-test database helpers.
// Uses the application's own pg pool (src/db) so tests exercise the production
// connection path. resetDb() truncates mutable CRM/application tables between
// tests, leaving migration-seeded reference data intact, and is guarded so it
// can ONLY run against a database whose name contains "test".
import { pool } from "../db";

let verifiedTestDb = false;

async function assertTestDatabase(): Promise<void> {
  if (verifiedTestDb) return;
  const { rows } = await pool.query<{ db: string }>(
    "SELECT current_database() AS db",
  );
  const db = (rows[0]?.db || "").toLowerCase();
  if (!/test/.test(db)) {
    throw new Error(
      `[integration-db] Refusing destructive reset against database "${db}". ` +
        `Integration tests require a database whose name contains "test".`,
    );
  }
  verifiedTestDb = true;
}

const MUTABLE_TABLES = [
  "bi_contact_activity",
  "bi_documents",
  "bi_applications",
  "bi_contacts",
  "bi_companies",
];

export async function resetDb(): Promise<void> {
  await assertTestDatabase();
  await pool.query(
    `TRUNCATE ${MUTABLE_TABLES.join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export interface SeededCompany {
  id: string;
  legal_name: string;
}

export async function seedCompany(
  fields: Partial<{
    legal_name: string;
    operating_name: string;
    business_number: string;
    industry: string;
  }> = {},
): Promise<SeededCompany> {
  const {
    legal_name = "Acme Inc",
    operating_name = null,
    business_number = null,
    industry = null,
  } = fields as Record<string, string | null>;
  const { rows } = await pool.query<SeededCompany>(
    `INSERT INTO bi_companies (legal_name, operating_name, business_number, industry)
     VALUES ($1, $2, $3, $4)
     RETURNING id, legal_name`,
    [legal_name, operating_name, business_number, industry],
  );
  return rows[0];
}

export async function seedContact(
  companyId: string,
  fields: Partial<{ full_name: string; email: string; phone_e164: string }> = {},
): Promise<{ id: string }> {
  const {
    full_name = "Jane Doe",
    email = null,
    phone_e164 = null,
  } = fields as Record<string, string | null>;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bi_contacts (company_id, full_name, email, phone_e164)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [companyId, full_name, email, phone_e164],
  );
  return rows[0];
}
