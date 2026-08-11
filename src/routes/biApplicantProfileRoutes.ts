// BI_CLIENT_PROFILE_v22 - step 1 of the BI-Client construction flow.
// Business name, applicant name and email. The mobile number is not accepted
// from the body on purpose: it is already proven by the OTP, and taking it
// from the request would let a caller write an application against someone
// else's number.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { authApplicant, type ApplicantReq } from "./applicantAuth";

const router = Router();

const COUNTRIES = new Set(["CA", "US"]);
function normCountry(raw: unknown): "CA" | "US" {
  const value = String(raw ?? "").trim().toUpperCase();
  return COUNTRIES.has(value) ? (value as "CA" | "US") : "CA";
}

const str = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

async function resolveIndustry(raw: unknown): Promise<{ code: string; naics: string; wantsContract: boolean }> {
  const requested = String(raw ?? "").trim().toLowerCase();
  const result = await pool.query<{ code: string; naics_code: string; wants_contract: boolean }>(
    `SELECT code, naics_code, wants_contract FROM bi_industries
      WHERE active = TRUE AND code = $1 LIMIT 1`,
    [requested],
  ).catch(() => ({ rows: [] as any[] }));
  const row = result.rows[0];
  if (row) return { code: row.code, naics: row.naics_code, wantsContract: row.wants_contract };
  return { code: "other", naics: "561990", wantsContract: false };
}

router.post("/applicants/profile", authApplicant, async (req: ApplicantReq, res) => {
  const phone = String(req.applicantPhone);
  const businessName = str(req.body?.businessName, 200);
  const applicantName = str(req.body?.applicantName, 200);
  const email = str(req.body?.email, 200);
  const country = normCountry(req.body?.country);
  const industry = await resolveIndustry(req.body?.industry);
  const source = str(req.body?.src, 60).toLowerCase();

  if (!businessName || !applicantName) return res.status(400).json({ error: "missing_name" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "invalid_email" });
  }

  // One in-flight application per applicant. Re-submitting step 1 corrects the
  // details rather than opening a second application.
  const existing = await pool.query<{ id: string; public_id: string }>(
    `SELECT id, public_id FROM bi_applications
      WHERE (applicant_phone_e164 = $1 OR guarantor_phone = $1)
        AND status IN ('created','in_progress')
      ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );

  let appId: string;
  let publicId: string;
  if (existing.rows[0]) {
    appId = existing.rows[0].id;
    publicId = existing.rows[0].public_id;
    await pool.query(
      `UPDATE bi_applications
          SET country = $2,
              data = COALESCE(data,'{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [appId, country, JSON.stringify({ businessName, applicantName, email,
        industry: industry.code, naics_code: industry.naics, ...(source ? { source } : {}) })],
    );
  } else {
    appId = randomUUID();
    publicId = `bi-${randomUUID().slice(0, 8)}`;
    await pool.query(
      `INSERT INTO bi_applications
         (id, public_id, status, source, created_by_actor, country,
          applicant_phone_e164, data, created_at, updated_at)
       VALUES ($1,$2,'created','public','applicant',$3,$4,$5::jsonb,NOW(),NOW())`,
      [appId, publicId, country, phone, JSON.stringify({ businessName, applicantName, email,
        industry: industry.code, naics_code: industry.naics, ...(source ? { source } : {}) })],
    );
  }

  // Keep the CRM contact in step with what the applicant just told us. The OTP
  // route creates this row with a placeholder name when the phone is new.
  await pool.query(
    `UPDATE bi_contacts
        SET full_name = $2, email = COALESCE(NULLIF($3,''), email), company_name = $4
      WHERE phone_e164 = $1`,
    [phone, applicantName, email, businessName],
  ).catch(() => { /* Contact shape varies by silo history; never fail step 1 on it. */ });

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
     VALUES($1,'applicant','profile_saved',$2)`,
    [appId, `Step 1 completed for ${businessName}`],
  ).catch(() => {});

  res.json({ applicationId: publicId, phone, industry: industry.code, wantsContract: industry.wantsContract });
});

export default router;
