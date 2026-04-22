import { pool } from "../db";
import { submitToPGI, type BIApplication } from "./pgiAdapter";

type ApplicationRow = {
  id: string;
  pgi_external_id: string | null;
  stage: string;
  data: Record<string, unknown> | null;
  applicant_phone_e164: string | null;
  lender_name: string | null;
  guarantor_name: string | null;
  guarantor_email: string | null;
  company_name: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
};

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length ? value.trim() : undefined;
}

function buildBIApplicationFromRow(row: ApplicationRow): BIApplication {
  const data = row.data ?? {};
  const [firstName, ...lastNameParts] = String(data.first_name ?? row.primary_contact_name ?? "Applicant").trim().split(" ");

  return {
    id: row.id,
    businessName: toStringOrUndefined(data.business_name) || toStringOrUndefined(data.client_name) || row.company_name || "Unknown business",
    registrationNumber: toStringOrUndefined(data.registration_number),
    industry: toStringOrUndefined(data.industry),
    firstName,
    lastName: toStringOrUndefined(data.last_name) || lastNameParts.join(" ") || "Unknown",
    email: toStringOrUndefined(data.email) || row.primary_contact_email || row.guarantor_email || "unknown@example.com",
    phone: toStringOrUndefined(data.phone) || toStringOrUndefined(data.client_phone) || row.applicant_phone_e164 || "",
    loanAmount: toNumber(data.loan_amount ?? data.loanAmount),
    loanType: (toStringOrUndefined(data.loan_type) as "secured" | "unsecured") || "unsecured",
    lender: row.lender_name || toStringOrUndefined(data.lender_name),
    coveragePercent: toNumber(data.coverage_percent, 80),
    guarantorName: row.guarantor_name || toStringOrUndefined(data.guarantor_name),
    guarantorEmail: row.guarantor_email || toStringOrUndefined(data.guarantor_email),
    scoringAnswers: {
      country: toStringOrUndefined(data.country) ?? null,
      naics_code: toStringOrUndefined(data.naics_code) ?? null,
      formation_date: toStringOrUndefined(data.formation_date) ?? null,
      loan_amount: toNumber(data.loan_amount ?? data.loanAmount),
      pgi_limit: toNumber(data.pgi_limit),
      annual_revenue: toNumber(data.annual_revenue),
      ebitda: toNumber(data.ebitda),
      total_debt: toNumber(data.total_debt),
      monthly_debt_service: toNumber(data.monthly_debt_service),
      collateral_value: toNumber(data.collateral_value),
      enterprise_value: toNumber(data.enterprise_value),
      bankruptcy_history: Boolean(data.bankruptcy_history),
      insolvency_history: Boolean(data.insolvency_history),
      judgment_history: Boolean(data.judgment_history)
    }
  };
}

export async function submitApplicationToPGI(applicationId: string): Promise<{ externalId: string; status: string; alreadySubmitted: boolean }> {
  const appResult = await pool.query<ApplicationRow>(
    `SELECT a.id, a.pgi_external_id, a.stage, a.data, a.applicant_phone_e164, a.lender_name, a.guarantor_name, a.guarantor_email,
            co.legal_name AS company_name,
            c.full_name AS primary_contact_name,
            c.email AS primary_contact_email
     FROM bi_applications a
     LEFT JOIN bi_companies co ON co.id = a.company_id
     LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
     WHERE a.id = $1
     LIMIT 1`,
    [applicationId]
  );

  const app = appResult.rows[0];
  if (!app) {
    throw new Error("Application not found");
  }

  if (app.pgi_external_id) {
    const statusResult = await pool.query<{ status: string | null }>(
      `SELECT data->>'status' AS status
       FROM pgi_applications
       WHERE id::text = $1 OR data->>'externalId' = $1
       LIMIT 1`,
      [app.pgi_external_id]
    );

    return {
      externalId: app.pgi_external_id,
      status: statusResult.rows[0]?.status || app.stage,
      alreadySubmitted: true
    };
  }

  const payload = buildBIApplicationFromRow(app);
  const result = await submitToPGI(payload);

  await pool.query(
    `UPDATE bi_applications
     SET pgi_external_id = $2,
         stage = 'under_review',
         updated_at = NOW()
     WHERE id = $1`,
    [applicationId, result.externalId]
  );

  await pool.query(
    `INSERT INTO pgi_applications(id, data)
     VALUES($1, $2::jsonb)
     ON CONFLICT (id)
     DO UPDATE SET data = EXCLUDED.data`,
    [applicationId, JSON.stringify({ applicationId, externalId: result.externalId, status: result.status })]
  );

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
     VALUES($1, 'system', 'submitted_to_pgi', 'Submitted to PGI', $2::jsonb)`,
    [applicationId, JSON.stringify({ externalId: result.externalId, status: result.status })]
  );

  return { ...result, alreadySubmitted: false };
}
