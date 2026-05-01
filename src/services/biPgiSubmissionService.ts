import { pool } from "../db";
import { buildCarrierPayloadFromRow } from "./pgiCarrierMapper"; // PGI_API_ALIGN_v57
import { submitToPGI, type BIApplication } from "./pgiAdapter";
import { requiredSlotsFor, type BiDocSlot } from "../lib/biDocumentRequirements";
// BI_PGI_ALIGNMENT_v56 — reads from bi_applications.data which now contains the full PGI form_data shape.
// BI_BLOCK_1_21_DOC_POLICY_OCR_BISERVER — adds documents_text bundle to PGI submission.

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

  // BI_BLOCK_1_21_DOC_POLICY_OCR_BISERVER — assemble OCR'd document bundle.
  const documentsText = await assembleDocumentsTextBundle(applicationId);
  if (documentsText) {
    (payload as any).documents_text = documentsText;
  }

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




// BI_BLOCK_1_21_DOC_POLICY_OCR_BISERVER — bundles all OCR'd documents for an
// application into a single markdown text blob with metadata headers per
// document. Skips documents still pending or failed (notes them in the
// bundle so PGI sees what was attempted).
async function assembleDocumentsTextBundle(applicationId: string): Promise<string | null> {
  const docs = await pool.query<{
    id: string;
    doc_type: string;
    original_filename: string | null;
    mime_type: string | null;
    ocr_status: string;
    extracted_text: string | null;
    ocr_error: string | null;
    created_at: string;
  }>(
    `SELECT id, doc_type, original_filename, mime_type, ocr_status, extracted_text, ocr_error, created_at
     FROM bi_documents
     WHERE application_id = $1 AND purged_at IS NULL
     ORDER BY created_at ASC`,
    [applicationId]
  );

  if (!docs.rows.length) return null;

  const typeLabels = await pool.query<{ doc_type: string; display_label: string }>(
    `SELECT doc_type, display_label FROM bi_required_doc_catalog WHERE active = TRUE`
  );
  const labelByType = new Map(typeLabels.rows.map((r) => [r.doc_type, r.display_label]));

  const sections: string[] = [
    `# Document Bundle for Application ${applicationId}`,
    `Generated ${new Date().toISOString()}. OCR engine: Azure AI Vision.`,
    `Total documents: ${docs.rows.length}.`,
    "",
  ];

  for (const doc of docs.rows) {
    const label = labelByType.get(doc.doc_type) ?? doc.doc_type;
    sections.push(`## ${label}`);
    sections.push(`[Filename: ${doc.original_filename ?? "(unknown)"} | MIME: ${doc.mime_type ?? "(unknown)"} | Uploaded: ${doc.created_at} | OCR status: ${doc.ocr_status}]`);
    sections.push("");
    if (doc.ocr_status === "complete" && doc.extracted_text) sections.push(doc.extracted_text);
    else if (doc.ocr_status === "failed") sections.push(`[OCR FAILED: ${doc.ocr_error ?? "unknown error"}]`);
    else if (doc.ocr_status === "skipped") sections.push(`[OCR SKIPPED: unsupported MIME type ${doc.mime_type ?? "(unknown)"}]`);
    else sections.push(`[OCR ${doc.ocr_status} — extraction not yet complete]`);
    sections.push("", "---", "");
  }

  return sections.join("\n");
}

// PGI_API_ALIGN_v57 — strict carrier payload builder, single source of truth.
// Any code path forwarding to PGI MUST go through this function so the
// 18-field contract is enforced at exactly one place.
export function buildPgiPayload(row: {
  guarantor_name: string;
  guarantor_email: string;
  lender_name: string | null;
  data: Record<string, unknown>;
}) {
  return buildCarrierPayloadFromRow(row);
}


// BI_DOC_LIST_v61 — every required slot must be present AND accepted before
// we forward the dossier to PGI. This is intentionally redundant with the
// route-level stage gate: routes can be added carelessly; this gate is the
// last thing checked before the outbound HTTP call.

export type CarrierDocReadiness =
  | { ready: true }
  | { ready: false; missing: BiDocSlot[]; rejected: BiDocSlot[]; pending: BiDocSlot[] };

export async function assertDocsReadyForCarrier(applicationId: string, formationDate: string | null): Promise<CarrierDocReadiness> {
  const required = new Set(requiredSlotsFor(formationDate ?? null));
  if (required.size === 0) return { ready: true };

  const r = await pool.query<{ doc_slot: string | null; status: string }>(
    `SELECT doc_slot, status FROM bi_documents WHERE application_id = $1`,
    [applicationId],
  );

  // For each required slot, find the latest version's status.
  const latest = new Map<string, string>();
  for (const row of r.rows) {
    if (!row.doc_slot) continue;
    if (!latest.has(row.doc_slot)) latest.set(row.doc_slot, row.status);
  }

  const missing: BiDocSlot[] = [];
  const rejected: BiDocSlot[] = [];
  const pending: BiDocSlot[] = [];
  for (const slot of required) {
    const st = latest.get(slot);
    if (!st) { missing.push(slot); continue; }
    if (st === "rejected") { rejected.push(slot); continue; }
    if (st !== "accepted") { pending.push(slot); continue; }
  }

  if (missing.length === 0 && rejected.length === 0 && pending.length === 0) {
    return { ready: true };
  }
  return { ready: false, missing, rejected, pending };
}
