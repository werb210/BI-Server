// BI_SERVER_BLOCK_v248_APPLICATIONS_FROM_BF_v1
// POST /api/v1/bi/applications/from-bf
// Service-to-service handoff from BF-Server when a BF applicant
// opts into PGI on Step 6. Auth is a service JWT signed with the
// shared JWT_SECRET (decision A1, no new env var). On success returns
// a completion_url that BF puts into the client mini-portal messenger.
import express, { type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { env } from "../platform/env";
import { logger } from "../platform/logger";

const router = express.Router();

function getSecret(): string {
  return (env.JWT_SECRET as string | undefined) || process.env.JWT_SECRET || "";
}

function verifyServiceJwt(req: Request): { source: string } | null {
  const auth = req.header("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const secret = getSecret();
  if (!secret) return null;
  try {
    const p = jwt.verify(m[1], secret) as { kind?: string; source?: string };
    if (p?.kind !== "service" || !p?.source) return null;
    return { source: String(p.source) };
  } catch {
    return null;
  }
}

function s(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[, $]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Generate a short application_code consistent with other BI flows.
function genApplicationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "BI-";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function completionUrl(publicId: string): string {
  // BI-Website public application landing. Applicant OTPs with the
  // phone we passed in, then lands on the partly-filled form.
  // BI_SERVER_BLOCK_v403 — land on /form (the partly-filled underwriting form),
  // not a bare /applications/<id> that has no route on bi-website.
  return `https://www.boreal.insure/login?next=/applications/${encodeURIComponent(publicId)}/form`;
}

router.post("/applications/from-bf", async (req: Request, res: Response) => {
  const svc = verifyServiceJwt(req);
  if (!svc) return res.status(401).json({ error: "service_jwt_required" });
  if (svc.source !== "bf-server") {
    return res.status(403).json({ error: "service_source_not_allowed" });
  }

  const b: any = req.body ?? {};
  const bfApplicationId = s(b.bf_application_id);
  if (!bfApplicationId) {
    return res.status(400).json({ error: "bf_application_id_required" });
  }

  // Idempotency: if BF resubmits, return the existing row.
  try {
    const existing = await pool.query<{ public_id: string; application_code: string }>(
      `SELECT public_id, application_code FROM bi_applications
        WHERE bf_application_id = $1 LIMIT 1`,
      [bfApplicationId],
    );
    if (existing.rows[0]) {
      return res.json({
        ok: true,
        idempotent: true,
        public_id: existing.rows[0].public_id,
        application_code: existing.rows[0].application_code,
        completion_url: completionUrl(existing.rows[0].public_id),
      });
    }
  } catch (e) {
    logger.error({ err: e }, "from_bf_idempotency_lookup_failed");
  }

  const id = randomUUID();
  const publicId = randomUUID();
  const applicationCode = genApplicationCode();

  const guarantorName = s(b.guarantor_name);
  const guarantorEmail = s(b.guarantor_email);
  const guarantorPhone = s(b.guarantor_phone);
  const businessName = s(b.business_name);
  const lenderName = s(b.lender_name);
  const loanAmount = num(b.loan_amount);
  // pgi_limit defaults to 80% of loan_amount per CORE scoring rules.
  const pgiLimit = num(b.pgi_limit) ?? (loanAmount != null ? Math.round(loanAmount * 0.8) : null);
  const annualRevenue = num(b.annual_revenue);
  const collateralValue = num(b.collateral_value);

  const naicsCode = s(b.naics_code);
  const naicsConfidence = b.naics_confidence === true || b.naics_confidence === "true" ? true
    : b.naics_confidence === false || b.naics_confidence === "false" ? false
    : null;

  // form_data JSONB stores everything BF gave us so the BI completion
  // form can pre-fill (decision B2).
  const formData = {
    bf_application_id: bfApplicationId,
    guarantor_name: guarantorName,
    guarantor_email: guarantorEmail,
    guarantor_phone: guarantorPhone,
    guarantor_dob: s(b.guarantor_dob),
    guarantor_address: s(b.guarantor_address),
    business_name: businessName,
    business_address: s(b.business_address),
    entity_type: s(b.entity_type),
    business_number: s(b.business_number),
    naics_code: naicsCode,
    naics_confidence: naicsConfidence,
    formation_date: s(b.formation_date),
    loan_amount: loanAmount,
    pgi_limit: pgiLimit,
    lender_name: lenderName,
    loan_purpose: s(b.loan_purpose),
    annual_revenue: annualRevenue,
    collateral_value: collateralValue,
  };

  try {
    await pool.query(
      `INSERT INTO bi_applications
         (id, public_id, application_code,
          status, source, source_type, created_by_actor,
          bf_application_id,
          guarantor_name, guarantor_email,
          applicant_phone_e164,
          business_name, lender_name,
          loan_amount, pgi_limit, annual_revenue, collateral_value,
          naics_code, naics_confidence,
          entity_type, guarantor_dob, guarantor_address, business_address, loan_purpose, formation_date,
          data,
          created_at, updated_at)
       VALUES ($1,$2,$3,
               'created','bf_pgi_referral','public','system',
               $4,
               $5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17,$18,$19,$20,$21,
               $22::jsonb, NOW(), NOW())`,
      [
        id, publicId, applicationCode,
        bfApplicationId,
        guarantorName, guarantorEmail, guarantorPhone,
        businessName, lenderName,
        loanAmount, pgiLimit, annualRevenue, collateralValue,
        naicsCode, naicsConfidence,
        // BI_SERVER_BLOCK_v404 — populate the columns the BI form pre-fills from
        // (these were previously stored only inside `data`).
        s(b.entity_type), s(b.guarantor_dob), s(b.guarantor_address), s(b.business_address), s(b.loan_purpose), s(b.formation_date),
        JSON.stringify(formData),
      ],
    );
  } catch (e: any) {
    logger.error({ err: e, bfApplicationId }, "from_bf_insert_failed");
    return res.status(500).json({ error: "insert_failed", detail: e?.message });
  }

  return res.json({
    ok: true,
    public_id: publicId,
    application_code: applicationCode,
    completion_url: completionUrl(publicId),
  });
});

export default router;
