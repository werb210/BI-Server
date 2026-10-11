import { Router } from "express";
import sgMail from "@sendgrid/mail";
import { pool } from "../db";
import { ENV } from "../config/env";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();

// BI_SERVER_BLOCK_48_v1 -- minimal /me endpoint for BI portal bootstrap.
// BI_SERVER_v784_STAFF_PROFILE - also returns full_name, email and phone_e164
// from bi_staff_profile; the portal settings page reads and edits them.
type StaffProfileRow = { full_name: string | null; email: string | null; phone_e164: string | null };

function staffIdFromUser(u: any): string | null {
  const id = u?.staffUserId ?? u?.id ?? u?.userId ?? null;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

router.get("/me", async (req: any, res) => {
  const u = req.user ?? {};
  const staffId = staffIdFromUser(u);
  let profile: StaffProfileRow | undefined;
  if (staffId) {
    try {
      const r = await pool.query<StaffProfileRow>(
        `SELECT full_name, email, phone_e164 FROM bi_staff_profile WHERE staff_user_id = $1 LIMIT 1`,
        [staffId],
      );
      profile = r.rows[0];
    } catch (err) {
      console.error("[bi/me] staff profile lookup failed", err instanceof Error ? err.message : err);
    }
  }
  res.json({
    id: u.id ?? u.userId ?? u.staffUserId ?? null,
    email: profile?.email ?? u.email ?? null,
    name: u.name ?? u.fullName ?? profile?.full_name ?? null,
    roles: Array.isArray(u.roles) ? u.roles : (u.role ? [u.role] : []),
    silo: String(u.silo ?? "BI").toUpperCase(),
    full_name: profile?.full_name ?? u.name ?? u.fullName ?? null,
    phone_e164: profile?.phone_e164 ?? null,
  });
});

const ME_FIELDS = new Set(["full_name", "email", "phone_e164"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{7,14}$/;

router.patch("/me", async (req: any, res) => {
  const u = req.user ?? {};
  // Staff only: service tokens have no profile to edit.
  if (u.kind === "service" || u.scope === "bi:service") {
    return res.status(403).json({ status: "error", error: "staff_only" });
  }
  const staffId = staffIdFromUser(u);
  if (!staffId) return res.status(403).json({ status: "error", error: "staff_only" });

  const b = req.body;
  if (!b || typeof b !== "object" || Array.isArray(b)) return badRequest(res, "JSON object body required");
  const unknown = Object.keys(b).filter((k) => !ME_FIELDS.has(k));
  if (unknown.length) return badRequest(res, `Unsupported fields: ${unknown.join(", ")}`);
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  if (!has("full_name") && !has("email") && !has("phone_e164")) return badRequest(res, "No fields to update");

  let fullName: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  if (has("full_name")) {
    if (typeof b.full_name !== "string" || !b.full_name.trim() || b.full_name.trim().length > 200) {
      return badRequest(res, "full_name must be 1-200 characters");
    }
    fullName = b.full_name.trim();
  }
  if (has("email")) {
    if (b.email !== null && (typeof b.email !== "string" || b.email.trim().length > 254 || !EMAIL_RE.test(b.email.trim()))) {
      return badRequest(res, "email is invalid");
    }
    email = b.email === null ? null : b.email.trim().toLowerCase();
  }
  if (has("phone_e164")) {
    if (b.phone_e164 !== null && (typeof b.phone_e164 !== "string" || !E164_RE.test(b.phone_e164.trim()))) {
      return badRequest(res, "phone_e164 must be E.164, e.g. +15875551234");
    }
    phone = b.phone_e164 === null ? null : b.phone_e164.trim();
  }

  const r = await pool.query<StaffProfileRow>(
    `INSERT INTO bi_staff_profile (staff_user_id, full_name, email, phone_e164)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (staff_user_id) DO UPDATE SET
       full_name  = CASE WHEN $5::boolean THEN EXCLUDED.full_name  ELSE bi_staff_profile.full_name  END,
       email      = CASE WHEN $6::boolean THEN EXCLUDED.email      ELSE bi_staff_profile.email      END,
       phone_e164 = CASE WHEN $7::boolean THEN EXCLUDED.phone_e164 ELSE bi_staff_profile.phone_e164 END,
       updated_at = NOW()
     RETURNING full_name, email, phone_e164`,
    [staffId, fullName, email, phone, has("full_name"), has("email"), has("phone_e164")],
  );
  const row = r.rows[0];
  return res.json({
    id: staffId,
    full_name: row?.full_name ?? null,
    email: row?.email ?? null,
    phone_e164: row?.phone_e164 ?? null,
  });
});

if (ENV.SENDGRID_API_KEY) {
  sgMail.setApiKey(ENV.SENDGRID_API_KEY);
}

router.post("/contact", async (req, res) => {
  try {
    const { company, name, email, phone } = req.body;

    if (!name || !email || !phone) {
      return badRequest(res, "Missing required fields");
    }

    await pool.query(
      `INSERT INTO contact_leads(company,name,email,phone)
       VALUES($1,$2,$3,$4)`,
      [company ?? null, name, email, phone]
    );

    return ok(res, { success: true });
  } catch (error) {
    console.error("Failed to submit contact lead", error);
    return badRequest(res, "Server error");
  }
});

router.post("/referrals", async (req, res) => {
  const client = await pool.connect();

  try {
    const { referrer, referrals } = req.body;

    if (!referrer || !Array.isArray(referrals) || referrals.length === 0) {
      return badRequest(res, "Invalid payload");
    }

    await client.query("BEGIN");

    const refResult = await client.query(
      `INSERT INTO referrers(company,name,email,phone)
       VALUES($1,$2,$3,$4)
       RETURNING id`,
      [referrer.company, referrer.name, referrer.email, referrer.phone]
    );

    const referrerId = refResult.rows[0].id;

    for (const referral of referrals) {
      await client.query(
        `INSERT INTO referrals(referrer_id,company,name,email,phone)
         VALUES($1,$2,$3,$4,$5)`,
        [referrerId, referral.company, referral.name, referral.email, referral.phone]
      );
    }

    await client.query("COMMIT");

    return ok(res, { success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to submit referrals", error);
    return badRequest(res, "Server error");
  } finally {
    client.release();
  }
});

router.post("/lender-login", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return badRequest(res, "Email required");
    }

    let lender = await pool.query(`SELECT * FROM lenders WHERE email=$1`, [email]);

    if (lender.rows.length === 0) {
      lender = await pool.query(`INSERT INTO lenders(email) VALUES($1) RETURNING *`, [email]);
    }

    return ok(res, { success: true, lender: lender.rows[0] });
  } catch (error) {
    console.error("Failed lender login", error);
    return badRequest(res, "Server error");
  }
});

router.post("/pgi-application", async (req, res) => {
  try {
    const data = req.body;

    if (!data.personal || !data.loan) {
      return badRequest(res, "Invalid application");
    }

    try {
      await pool.query(`INSERT INTO pgi_applications(data) VALUES($1)`, [data]);
    } catch {
      await pool.query(
        `INSERT INTO pgi_applications(first_name,last_name,email,phone,business_name,loan_amount,data)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          data.personal.firstName ?? null,
          data.personal.lastName ?? null,
          data.personal.email,
          data.personal.phone ?? null,
          data.loan.businessName ?? data.loan.company ?? "Unknown",
          data.loan.amount ?? null,
          data
        ]
      );
    }

    if (ENV.SENDGRID_API_KEY && ENV.SENDGRID_FROM) {
      await sgMail.send({
        to: data.personal.email,
        from: ENV.SENDGRID_FROM,
        subject: "PGI Application Received",
        html: `<h2>Application Received</h2><p>Thank you ${data.personal.firstName}, your application has been submitted.</p>`
      });
    }

    return ok(res, { success: true });
  } catch (error) {
    console.error("Failed PGI application", error);
    return badRequest(res, "Server error");
  }
});

export default router;
