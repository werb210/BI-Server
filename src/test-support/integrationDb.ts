// BI_SERVER_BLOCK_v356_TEST_DB_HARNESS - integration-test database helpers.
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
  // BI_SERVER_v789 - carrier-path integration tests write these too.
  "bi_webhook_log",
  "bi_events",
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

// BI_SERVER_v789 - application + document seeds for carrier-path tests.
export async function seedApplication(
  fields: Partial<{
    status: string;
    stage: string;
    source_type: string;
    pgi_application_id: string | null;
    submission_locked: boolean;
  }> = {},
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bi_applications (created_by_actor, source_type, status, stage, pgi_application_id, submission_locked, data)
     VALUES ('applicant', $1, $2, $3::bi_pipeline_stage, $4, $5, '{}'::jsonb)
     RETURNING id`,
    [
      fields.source_type ?? "public",
      fields.status ?? "document_review",
      fields.stage ?? "documents_pending",
      fields.pgi_application_id ?? null,
      fields.submission_locked ?? false,
    ],
  );
  return rows[0];
}

export async function seedDocument(
  applicationId: string,
  fields: Partial<{ doc_type: string; review_status: string; storage_key: string | null; purged: boolean }> = {},
): Promise<{ id: string }> {
  const docType = fields.doc_type ?? "loan_agreement";
  const key = fields.storage_key === undefined ? `applications/${applicationId}/${docType}.pdf` : fields.storage_key;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bi_documents (application_id, doc_type, original_filename, storage_key, blob_name, mime_type, uploaded_by_actor, review_status, purged_at)
     VALUES ($1, $2::bi_document_type, $3, $4, $4, 'application/pdf', 'applicant', $5, CASE WHEN $6::boolean THEN NOW() ELSE NULL END)
     RETURNING id`,
    [applicationId, docType, `${docType}.pdf`, key, fields.review_status ?? "accepted", fields.purged ?? false],
  );
  return rows[0];
}
