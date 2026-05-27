import { pool } from "../db";
import { buildCarrierPayloadFromRow } from "./pgiCarrierMapper"; // PGI_API_ALIGN_v57
import { submitToPGI, type BIApplication } from "./pgiAdapter";
import { requiredSlotsFor, type BiDocSlot } from "../lib/biDocumentRequirements";
// BI_PGI_ALIGNMENT_v56 — reads from bi_applications.data which now contains the full PGI form_data shape.
// BI_BLOCK_1_21_DOC_POLICY_OCR_BISERVER — adds documents_text bundle to PGI submission.

type ApplicationRow = {
  id: string;
  // BI_SERVER_BLOCK_v264_ORCHESTRATOR_PGI_APP_ID_v1
  pgi_application_id: string | null;
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
  // BI_SERVER_BLOCK_v270_ORCHESTRATOR_RACE_CLAIM_v1
  // Atomic claim: only one request can flip submission_locked=FALSE→TRUE
  // for a row that hasn't already been carrier-submitted. Closes the
  // F-2 race without holding a row lock across the Markel network call.
  const claim = await pool.query<{ id: string }>(
    `UPDATE bi_applications
        SET submission_locked = TRUE,
            updated_at = NOW()
      WHERE id = $1
        AND pgi_application_id IS NULL
        AND pgi_external_id IS NULL
        AND submission_locked = FALSE
    RETURNING id`,
    [applicationId]
  );

  if (claim.rowCount === 0) {
    // Either already submitted, or another request is in flight.
    // Re-read to distinguish; either way return idempotent (the
    // route handler treats both the same — the UI reloads and the
    // button is hidden because submission_locked=TRUE).
    const re = await pool.query<{ pgi_application_id: string | null; pgi_external_id: string | null; stage: string }>(
      `SELECT pgi_application_id, pgi_external_id, stage
         FROM bi_applications WHERE id = $1 LIMIT 1`,
      [applicationId]
    );
    const r = re.rows[0];
    if (!r) {
      throw new Error("Application not found");
    }
    const existingCarrierId = r.pgi_application_id ?? r.pgi_external_id ?? null;
    if (existingCarrierId) {
      const statusResult = await pool.query<{ status: string | null }>(
        `SELECT data->>'status' AS status
         FROM pgi_applications
         WHERE id::text = $1 OR data->>'externalId' = $1
         LIMIT 1`,
        [existingCarrierId]
      );
      return {
        externalId: existingCarrierId,
        status: statusResult.rows[0]?.status || r.stage,
        alreadySubmitted: true
      };
    }
    // In flight by a concurrent request. UI reloads and sees
    // submission_locked=TRUE; button stays hidden.
    return { externalId: "", status: "in_flight", alreadySubmitted: true };
  }

  // We hold the claim. Hydrate the row for the carrier payload.
  const appResult = await pool.query<ApplicationRow>(
    `SELECT a.id, a.pgi_application_id, a.pgi_external_id, a.stage, a.data, a.applicant_phone_e164, a.lender_name, a.guarantor_name, a.guarantor_email,
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
    // Vanishingly unlikely (we just held the row in the UPDATE) but
    // release the claim and bail rather than throw with the row stuck.
    await pool.query(
      `UPDATE bi_applications SET submission_locked = FALSE
         WHERE id = $1 AND pgi_application_id IS NULL AND pgi_external_id IS NULL`,
      [applicationId]
    ).catch(() => {});
    throw new Error("Application not found");
  }

  const payload = buildBIApplicationFromRow(app);

  // BI_SERVER_BLOCK_v373_SECOND_ACCEPT_AND_TEXT_BUNDLE_v1
  // The OCR text bundle is no longer sent to the carrier. v359's
  // pgiUploadDocument sends binary multipart files which is what the v2
  // carrier spec expects. Sending the same content twice in two shapes
  // was redundant and risked the carrier reconciling them incorrectly.
  // The assembleDocumentsTextBundle function is still useful for internal
  // CRM/staff review — kept the import but no longer attaches to payload.

  // BI_SERVER_BLOCK_v270_ORCHESTRATOR_RACE_CLAIM_v1
  // Call the carrier OUTSIDE any lock. Submission_locked=TRUE from the
  // claim already prevents concurrent submits; this is the long step.
  let result: { externalId: string; status: string };
  try {
    result = await submitToPGI(payload);
  } catch (err) {
    // Release the claim so the user can retry (only release rows that
    // never reached the carrier — guards against releasing a row that
    // partially succeeded between two retries).
    await pool.query(
      `UPDATE bi_applications SET submission_locked = FALSE, updated_at = NOW()
         WHERE id = $1 AND pgi_application_id IS NULL AND pgi_external_id IS NULL`,
      [applicationId]
    ).catch(() => {});
    throw err;
  }

  // submission_locked already TRUE from the claim; v264 success UPDATE
  // simplified to the carrier columns that the claim didn't touch.
  await pool.query(
    `UPDATE bi_applications
     SET pgi_application_id = $2,
         pgi_external_id = $2,
         status = 'submitted',
         stage = 'under_review',
         carrier_received_at = COALESCE(carrier_received_at, NOW()),
         carrier_submission_request = $3::jsonb,
         carrier_submission_response = $4::jsonb,
         carrier_last_event = 'application.submitted',
         carrier_last_event_at = NOW(),
         -- BI_SERVER_BLOCK_v379_TEST1_FIX_PACK_v1 (Bug F)
         -- bi_applications has no submitted_at column;
         -- carrier_received_at above already records this timestamp.
         updated_at = NOW()
     WHERE id = $1`,
    [applicationId, result.externalId, JSON.stringify(payload), JSON.stringify(result)]
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

  // BI_SERVER_BLOCK_v380_READINESS_COALESCE_v1
  // Completes v379's Bug D fix. The previous version of this query was
  // a partial-merge of v379 that only fixed Bug B (column rename
  // status → review_status AS status). The full Bug D fix also needs:
  //   1. SELECT keys off doc_type when doc_slot is NULL. The public
  //      upload route at biPublicApplicationRoutes.ts:642 INSERTs rows
  //      with doc_slot=NULL (it only collects doc_type). The lender
  //      upload route (biLenderApplicationCreate.ts:260) sets
  //      doc_slot = docType (same string). COALESCE handles both paths.
  //   2. AND purged_at IS NULL — soft-deleted rows shouldn't satisfy
  //      the readiness gate.
  //   3. Loop reads row.slot (the COALESCE'd value), not row.doc_slot.
  // Without all three, the public send-to-carrier path returns
  // DOCS_NOT_READY missing:[every required slot] even when 5 valid
  // docs are uploaded and accepted.
  const r = await pool.query<{ slot: string | null; status: string }>(
    `SELECT COALESCE(doc_slot, doc_type::text) AS slot, review_status AS status
       FROM bi_documents WHERE application_id = $1 AND purged_at IS NULL`,
    [applicationId],
  );

  // For each required slot, find the latest version's status.
  const latest = new Map<string, string>();
  for (const row of r.rows) {
    if (!row.slot) continue;
    if (!latest.has(row.slot)) latest.set(row.slot, row.status);
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
