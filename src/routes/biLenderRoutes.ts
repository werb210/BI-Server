import { Router } from "express";
import { pool } from "../db";
import { badRequest, ok } from "../utils/apiResponse";
import { submitApplicationToPGI } from "../services/biPgiSubmissionService";

const router = Router();

function getUserId(req: unknown): string | null {
  const u = (req as { user?: { staffUserId?: string } }).user;
  return u?.staffUserId ?? null;
}

router.post("/lender/profile", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return badRequest(res, "Unauthorized");

  const { full_name, company_name, email, phone } = req.body as {
    full_name?: string;
    company_name?: string;
    email?: string;
    phone?: string;
  };

  if (!full_name || !company_name || !email || !phone) {
    return badRequest(res, "Name, company, email, and mobile are required");
  }

  await pool.query(
    `INSERT INTO bi_lenders(user_id, company_name, rep_full_name, rep_email)
     VALUES($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       company_name = EXCLUDED.company_name,
       rep_full_name = EXCLUDED.rep_full_name,
       rep_email = EXCLUDED.rep_email`,
    [userId, company_name, full_name, email]
  );

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
     VALUES(NULL, 'lender', $1, 'lender_profile_complete', 'Lender profile completed', $2::jsonb)`,
    [userId, JSON.stringify({ full_name, company_name, email, phone })]
  );

  return ok(res, { success: true });
});

router.get("/lender/me", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return badRequest(res, "Unauthorized");
  const r = await pool.query(`SELECT * FROM bi_lenders WHERE user_id=$1`, [userId]);
  return ok(res, { profile: r.rows[0] ?? null });
});

router.get("/lender/applications", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return badRequest(res, "Unauthorized");

  const lender = (await pool.query(`SELECT id FROM bi_lenders WHERE user_id=$1`, [userId])).rows[0];
  if (!lender) return ok(res, []);

  const rows = await pool.query(
    `SELECT a.id, a.stage, a.premium_calc, a.created_at, a.updated_at,
            c.full_name AS primary_contact_name,
            co.legal_name AS company_name
       FROM bi_applications a
  LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
  LEFT JOIN bi_companies co ON co.id = a.company_id
      WHERE a.created_by_lender_id = $1
      ORDER BY a.created_at DESC`,
    [lender.id]
  );

  return ok(res, rows.rows);
});

router.post("/lender/application", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return badRequest(res, "Unauthorized");

  const lender = (await pool.query(`SELECT id FROM bi_lenders WHERE user_id=$1`, [userId])).rows[0];
  if (!lender) return badRequest(res, "Complete lender profile first");

  const body = req.body as {
    business_name?: string;
    guarantor_name?: string;
    guarantor_email?: string;
    guarantor_phone?: string;
    lender_name?: string;
    form_data?: Record<string, unknown>;
  };

  const { business_name, guarantor_name, guarantor_email, guarantor_phone, lender_name } = body;
  const fd = body.form_data || {};

  const missing: string[] = [];
  if (!business_name) missing.push("business_name");
  if (!guarantor_name) missing.push("guarantor_name");
  if (!guarantor_email) missing.push("guarantor_email");
  if (!guarantor_phone) missing.push("guarantor_phone");
  if (!lender_name) missing.push("lender_name");

  for (const key of [
    "country",
    "naics_code",
    "formation_date",
    "loan_amount",
    "pgi_limit",
    "annual_revenue",
    "ebitda",
    "total_debt",
    "monthly_debt_service",
    "collateral_value",
    "enterprise_value"
  ]) {
    const v = fd[key];
    if (v === undefined || v === null || v === "") missing.push(`form_data.${key}`);
  }

  if (missing.length) {
    return badRequest(res, `Missing: ${missing.join(", ")}`);
  }

  const company = await pool.query(
    `INSERT INTO bi_companies(legal_name, industry) VALUES($1, $2) RETURNING id`,
    [business_name, String(fd.naics_code)]
  );
  const contact = await pool.query(
    `INSERT INTO bi_contacts(full_name, email, phone_e164, company_id)
     VALUES($1, $2, $3, $4) RETURNING id`,
    [guarantor_name, guarantor_email, guarantor_phone, company.rows[0].id]
  );

  const app = await pool.query(
    `INSERT INTO bi_applications(
       created_by_actor, created_by_user_id, created_by_lender_id,
       company_id, primary_contact_id, applicant_phone_e164,
       stage, data
     )
     VALUES('lender', $1, $2, $3, $4, $5, 'new_application', $6::jsonb)
     RETURNING id`,
    [
      userId,
      lender.id,
      company.rows[0].id,
      contact.rows[0].id,
      guarantor_phone,
      JSON.stringify({ ...fd, lender_name, business_name, guarantor_name, guarantor_email })
    ]
  );

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
     VALUES($1, 'lender', $2, 'application_created', $3, $4::jsonb)`,
    [app.rows[0].id, userId, `Lender submitted application for ${business_name}`, JSON.stringify({ lenderId: lender.id })]
  );

  let pgiResult: unknown = null;
  try {
    pgiResult = await submitApplicationToPGI(app.rows[0].id);
  } catch (err) {
    console.error("PGI submit from lender flow failed", err);
  }

  return ok(res, { applicationId: app.rows[0].id, pgi: pgiResult });
});

export default router;
