// BI_CLIENT_CONTRACT_ROUTES_v21
import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { pool } from "../db";
import { getStorage } from "../lib/storage";
import { analyzeContract } from "../services/contractRequirements"; // BI_CONTRACT_SCHEDULE_AWARE_v29
import { extractText } from "../services/ocrService";
import { authApplicant, type ApplicantReq } from "./applicantAuth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const COUNTRIES = new Set(["CA", "US"]);

function normCountry(raw: unknown): "CA" | "US" {
  const value = String(raw ?? "").trim().toUpperCase();
  return COUNTRIES.has(value) ? (value as "CA" | "US") : "CA";
}

type ReqRow = {
  id: string;
  coverage_code: string;
  extracted_limit: string | null;
  limit_basis: string | null;
  clause_text: string;
  confidence: string;
  confirmed_by_client: boolean | null;
};

function shape(row: ReqRow, names: Map<string, string>, sellable: Set<string>) {
  return {
    id: row.id,
    coverageCode: row.coverage_code,
    displayName: names.get(row.coverage_code) ?? row.coverage_code.toUpperCase(),
    available: sellable.has(row.coverage_code),
    extractedLimit: row.extracted_limit === null ? null : Number(row.extracted_limit),
    limitBasis: row.limit_basis,
    clauseText: row.clause_text,
    confidence: Number(row.confidence),
    confirmedByClient: row.confirmed_by_client,
  };
}

async function displayNames(country: string): Promise<Map<string, string>> {
  const [labels, products] = await Promise.all([
    pool.query<{ coverage_code: string; display_name: string }>(
      `SELECT coverage_code, display_name FROM bi_coverage_labels`,
    ),
    pool.query<{ code: string; display_name: string }>(
      `SELECT code, display_name FROM bi_products WHERE country = $1 AND active = TRUE`,
      [country],
    ),
  ]);
  const names = new Map(labels.rows.map((row) => [row.coverage_code, row.display_name]));
  for (const row of products.rows) names.set(row.code, row.display_name);
  return names;
}

async function sellableCodes(country: string): Promise<Set<string>> {
  const result = await pool.query<{ code: string }>(
    `SELECT code FROM bi_products WHERE country = $1 AND active = TRUE`,
    [country],
  );
  return new Set(result.rows.map((row) => row.code));
}

async function ownedApplication(publicIdOrId: string, phone: string) {
  const result = await pool.query(
    `SELECT id, public_id, country, applicant_phone_e164, guarantor_phone
       FROM bi_applications WHERE public_id = $1 OR id::text = $1 LIMIT 1`,
    [publicIdOrId],
  );
  const app = result.rows[0];
  if (!app) return { app: null as any, error: "not_found" as const };
  const owners = [app.applicant_phone_e164, app.guarantor_phone].filter(Boolean);
  if (!owners.includes(phone)) return { app: null as any, error: "not_owner" as const };
  return { app, error: null };
}

router.get("/applicants/industries", authApplicant, async (_req: ApplicantReq, res) => {
  const result = await pool.query(
    `SELECT code, display_name, wants_contract FROM bi_industries
      WHERE active = TRUE ORDER BY sort_order ASC, display_name ASC`,
  );
  res.json({ industries: result.rows });
});

router.get("/applicants/products", authApplicant, async (req: ApplicantReq, res) => {
  const country = normCountry(req.query.country);
  const industry = String(req.query.industry ?? "construction").trim().toLowerCase() || "construction";
  if (industry !== "construction") {
    const generic = await pool.query(
      `SELECT ic.coverage_code AS code,
              COALESCE(l.display_name, ic.coverage_code) AS display_name, ic.sort_order
         FROM bi_industry_coverages ic
         LEFT JOIN bi_coverage_labels l ON l.coverage_code = ic.coverage_code
        WHERE ic.industry_code = $1
        ORDER BY ic.sort_order ASC, display_name ASC`,
      [industry],
    );
    return res.json({ country, industry, kind: "categories", products: generic.rows.map((row: any) => ({
      code: row.code, display_name: row.display_name, carrier: null,
      coverage_category: row.code, tier: null, instant_bind: false,
      description: "", sort_order: row.sort_order,
    })) });
  }
  const result = await pool.query(
    `SELECT code, display_name, carrier, coverage_category, tier, instant_bind,
            description, sort_order
       FROM bi_products
      WHERE country = $1 AND industry = 'construction' AND active = TRUE
      ORDER BY sort_order ASC, display_name ASC`,
    [country],
  );
  res.json({ country, industry, kind: "products", products: result.rows });
});

router.post("/applicants/contract/upload", authApplicant, upload.single("file"), async (req: ApplicantReq, res) => {
  const phone = String(req.applicantPhone);
  const file = req.file;
  if (!file) return res.status(400).json({ error: "missing_file" });
  const country = normCountry(req.body?.country);
  const existing = await pool.query(
    `SELECT id, public_id, country FROM bi_applications
      WHERE (applicant_phone_e164 = $1 OR guarantor_phone = $1)
        AND status IN ('created','in_progress')
      ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );

  let appId: string;
  let publicId: string;
  let appCountry = country;
  if (existing.rows[0]) {
    appId = existing.rows[0].id;
    publicId = existing.rows[0].public_id;
    appCountry = normCountry(existing.rows[0].country ?? country);
  } else {
    appId = randomUUID();
    publicId = `bi-${randomUUID().slice(0, 8)}`;
    await pool.query(
      `INSERT INTO bi_applications
         (id, public_id, status, source, created_by_actor, country,
          applicant_phone_e164, data, created_at, updated_at)
       VALUES ($1,$2,'created','public','applicant',$3,$4,'{}'::jsonb,NOW(),NOW())`,
      [appId, publicId, appCountry, phone],
    );
  }

  const stored = await getStorage().put({
    buffer: file.buffer,
    filename: file.originalname,
    contentType: file.mimetype,
    pathPrefix: `applications/${appId}`,
  });
  const document = await pool.query<{ id: string }>(
    `INSERT INTO bi_documents
       (application_id, doc_type, original_filename, storage_key, blob_name,
        blob_url, sha256_hash, mime_type, bytes, uploaded_by_actor)
     VALUES ($1,'subcontract_agreement',$2,$3,$4,$5,$6,$7,$8,'applicant') RETURNING id`,
    [appId, file.originalname, stored.blobName, stored.blobName, stored.url, stored.hash, file.mimetype, stored.sizeBytes],
  );
  const documentId = document.rows[0].id;
  const ocr = await extractText({ buffer: file.buffer, mimeType: file.mimetype, filename: file.originalname });
  // BI_CONTRACT_SCHEDULE_AWARE_v29 - the agreement defers its coverage list to
  // Schedule I, a separate PDF. Record which demanded schedules are absent so
  // the applicant can be asked for them instead of being shown a short list.
  const analysis = ocr.status === "complete" && ocr.extractedText
    ? analyzeContract(ocr.extractedText)
    : { requirements: [], missingSchedules: [], documentKind: "requirements" as const };
  const found = analysis.requirements;
  await pool.query(
    `UPDATE bi_applications
        SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
      WHERE id = $1`,
    [appId, JSON.stringify({ missing_schedules: analysis.missingSchedules })],
  ).catch(() => {});

  for (const requirement of found) {
    await pool.query(
      `INSERT INTO bi_contract_requirements
         (application_id, document_id, coverage_code, extracted_limit, limit_basis, clause_text, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [appId, documentId, requirement.coverageCode, requirement.extractedLimit, requirement.limitBasis,
        requirement.clauseText, requirement.confidence],
    );
  }
  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
     VALUES($1,'applicant','document_uploaded',$2)`,
    [appId, `Subcontract uploaded: ${file.originalname} (${found.length} coverage requirements read${analysis.missingSchedules.length ? `; ${analysis.missingSchedules.map((schedule) => schedule.ref).join(", ")} not included` : ""})`],
  ).catch(() => {});

  const rows = await pool.query<ReqRow>(
    `SELECT id, coverage_code, extracted_limit, limit_basis, clause_text, confidence, confirmed_by_client
       FROM bi_contract_requirements WHERE application_id = $1 ORDER BY confidence DESC, coverage_code ASC`,
    [appId],
  );
  const [names, sellable] = await Promise.all([displayNames(appCountry), sellableCodes(appCountry)]);
  res.json({ applicationId: publicId, documentId, ocrStatus: ocr.status,
    documentKind: analysis.documentKind, // BI_CONTRACT_SCHEDULE_AWARE_v29
    missingSchedules: analysis.missingSchedules,
    requirements: rows.rows.map((row) => shape(row, names, sellable)) });
});

router.get("/applicants/applications/:id/requirements", authApplicant, async (req: ApplicantReq, res) => {
  const { app, error } = await ownedApplication(req.params.id, String(req.applicantPhone));
  if (error) return res.status(error === "not_found" ? 404 : 403).json({ error });
  const rows = await pool.query<ReqRow>(
    `SELECT id, coverage_code, extracted_limit, limit_basis, clause_text, confidence, confirmed_by_client
       FROM bi_contract_requirements WHERE application_id = $1 ORDER BY confidence DESC, coverage_code ASC`,
    [app.id],
  );
  const country = normCountry(app.country);
  const [names, sellable] = await Promise.all([displayNames(country), sellableCodes(country)]);
  // BI_CONTRACT_SCHEDULE_AWARE_v29
  const stored = await pool.query<{ missing_schedules: unknown }>(
    `SELECT COALESCE(data->'missing_schedules', '[]'::jsonb) AS missing_schedules
       FROM bi_applications WHERE id = $1`,
    [app.id],
  ).catch(() => ({ rows: [] as any[] }));
  const missingSchedules = Array.isArray(stored.rows[0]?.missing_schedules)
    ? (stored.rows[0]!.missing_schedules as { ref: string; title: string }[])
    : [];
  res.json({
    missingSchedules,
    documentKind: missingSchedules.length > 0 ? "agreement_only" : "requirements",
    requirements: rows.rows.map((row) => shape(row, names, sellable)),
  });
});

router.post("/applicants/applications/:id/requirements/:reqId/confirm", authApplicant, async (req: ApplicantReq, res) => {
  const { app, error } = await ownedApplication(req.params.id, String(req.applicantPhone));
  if (error) return res.status(error === "not_found" ? 404 : 403).json({ error });
  const confirmed = req.body?.confirmed === true;
  const updated = await pool.query<{ coverage_code: string }>(
    `UPDATE bi_contract_requirements SET confirmed_by_client = $3, confirmed_at = NOW()
      WHERE id = $1 AND application_id = $2 RETURNING coverage_code`,
    [req.params.reqId, app.id, confirmed],
  );
  if (!updated.rows[0]) return res.status(404).json({ error: "requirement_not_found" });

  const code = updated.rows[0].coverage_code;
  const country = normCountry(app.country);
  const available = (await sellableCodes(country)).has(code);

  if (confirmed && !available) {
    const requirement = await pool.query<{
      extracted_limit: string | null;
      limit_basis: string | null;
      clause_text: string;
    }>(
      `SELECT extracted_limit, limit_basis, clause_text FROM bi_contract_requirements
        WHERE id = $1 AND application_id = $2`,
      [req.params.reqId, app.id],
    );
    const detail = requirement.rows[0];
    await pool.query(
      `INSERT INTO bi_coverage_gaps
         (application_id, coverage_code, country, requested_limit, limit_basis, clause_text, source, status)
       VALUES ($1,$2,$3,$4,$5,$6,'contract','open')
       ON CONFLICT (application_id, coverage_code) DO UPDATE
         SET requested_limit = EXCLUDED.requested_limit,
             limit_basis = EXCLUDED.limit_basis,
             clause_text = EXCLUDED.clause_text,
             status = 'open',
             updated_at = NOW()`,
      [app.id, code, country, detail?.extracted_limit ?? null, detail?.limit_basis ?? null, detail?.clause_text ?? null],
    );
    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
       VALUES($1,'applicant','coverage_referral_needed',$2)`,
      [app.id, `${code} required by contract but not placeable in ${country} - referral needed`],
    ).catch(() => {});
    res.json({ ok: true, available: false, referred: true });
    return;
  }

  if (confirmed) {
    await pool.query(
      `INSERT INTO bi_application_products (application_id, product_id, source)
       SELECT $1, p.id, 'contract' FROM bi_products p
        WHERE p.code = $2 AND p.country = $3 AND p.active = TRUE
       ON CONFLICT (application_id, product_id) DO NOTHING`,
      [app.id, code, country],
    );
  } else {
    await pool.query(
      `DELETE FROM bi_coverage_gaps
        WHERE application_id = $1 AND coverage_code = $2 AND source = 'contract'`,
      [app.id, code],
    );
    await pool.query(
      `DELETE FROM bi_application_products ap USING bi_products p
        WHERE ap.product_id = p.id AND ap.application_id = $1
          AND p.code = $2 AND ap.source = 'contract'`,
      [app.id, code],
    );
  }
  res.json({ ok: true, available, referred: false });
});

export default router;
