import { Router } from "express";
import bcrypt from "bcrypt";
import { pool } from "../db";
import { signStaffToken } from "../platform/auth";
import { submitApplicationToPGI } from "../services/biPgiSubmissionService";
import { sendOtp, verifyOtp } from "../services/otpService";
import { calculatePremium } from "../services/premiumService";
import { badRequest, ok } from "../utils/apiResponse";

const publicRouter = Router();
export const biAppApplicantRoutes = Router();

publicRouter.post("/otp/request", async (req, res) => {
  const { phone, name, email, userType } = req.body as {
    phone?: string;
    name?: string;
    email?: string;
    userType?: string;
  };

  if (!phone || !name || !email) {
    return badRequest(res, "Name, email, and phone are required");
  }

  const [phoneRecent, ipRecent] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS n
         FROM bi_otp_sessions
        WHERE phone_e164 = $1
          AND requested_at > NOW() - INTERVAL '10 minutes'`,
      [phone]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n
         FROM bi_otp_sessions
        WHERE requested_ip = $1
          AND requested_at > NOW() - INTERVAL '10 minutes'`,
      [req.ip]
    )
  ]);

  if (phoneRecent.rows[0].n >= 2) {
    return badRequest(res, "Too many requests for this phone. Please wait a few minutes.");
  }

  if (ipRecent.rows[0].n >= 10) {
    return badRequest(res, "Too many OTP requests from this IP. Please wait a few minutes.");
  }

  try {
    await sendOtp(phone);

    await pool.query(
      `INSERT INTO bi_otp_sessions(phone_e164, purpose, name, email, user_type, requested_ip)
       VALUES($1, 'login', $2, $3, $4, $5)`,
      [phone, name, email, userType || "applicant", req.ip]
    );

    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
       VALUES(NULL, 'system', 'otp_requested', $1, $2::jsonb)`,
      [
        `OTP requested by ${name} <${email}>`,
        JSON.stringify({ phone, name, email, userType: userType || "applicant", requestedIp: req.ip })
      ]
    );

    return ok(res, { success: true });
  } catch (error) {
    console.error("OTP request failed", error);
    return badRequest(res, "Failed to request OTP");
  }
});

publicRouter.post("/otp/verify", async (req, res) => {
  const { phone, code } = req.body as { phone?: string; code?: string };

  if (!phone || !code) {
    return badRequest(res, "Phone and code required");
  }

  try {
    const approved = await verifyOtp(phone, code);

    if (!approved) {
      return badRequest(res, "Invalid code");
    }

    const sessionResult = await pool.query(
      `SELECT name, email, user_type FROM bi_otp_sessions
        WHERE phone_e164 = $1
        ORDER BY requested_at DESC NULLS LAST
        LIMIT 1`,
      [phone]
    );

    const session = sessionResult.rows[0] ?? {};
    const name = (session.name as string | undefined) ?? null;
    const email = (session.email as string | undefined) ?? null;
    const resolvedUserType = (session.user_type as string | undefined) || "applicant";

    let userResult = await pool.query("SELECT * FROM bi_users WHERE phone_e164=$1", [phone]);

    if (userResult.rows.length === 0) {
      userResult = await pool.query(
        `INSERT INTO bi_users(phone_e164, user_type)
         VALUES($1, $2)
         RETURNING *`,
        [phone, resolvedUserType]
      );
    }

    const user = userResult.rows[0];

    let profileComplete = true;
    if (resolvedUserType === "referrer") {
      const ref = await pool.query("SELECT id FROM bi_referrers WHERE user_id=$1", [user.id]);
      profileComplete = ref.rows.length > 0;
    } else if (resolvedUserType === "lender") {
      const lend = await pool.query("SELECT id FROM bi_lenders WHERE user_id=$1", [user.id]);
      profileComplete = lend.rows.length > 0;
    }

    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
       VALUES(NULL, 'system', 'otp_verified', $1, $2::jsonb)`,
      [
        `OTP verified for ${email || phone}`,
        JSON.stringify({ phone, name, email, userType: resolvedUserType, userId: user.id })
      ]
    );

    const token = signStaffToken({
      staffUserId: user.id,
      role: resolvedUserType,
      phone,
      userType: resolvedUserType
    });

    return ok(res, {
      success: true,
      token,
      tokenType: "Bearer",
      expiresIn: 28800,
      user: {
        id: user.id,
        name,
        email,
        phone,
        userType: resolvedUserType
      },
      profileComplete
    });
  } catch (error) {
    console.error("OTP verification failed", error);
    return badRequest(res, "Failed to verify OTP");
  }
});

publicRouter.post("/staff/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return badRequest(res, "Email and password are required");
  }

  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH) {
    return badRequest(res, "Staff login is not configured");
  }

  const emailMatches = email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();
  const passwordMatches = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);

  if (!emailMatches || !passwordMatches) {
    return badRequest(res, "Invalid staff credentials");
  }

  const token = signStaffToken({
    staffUserId: process.env.ADMIN_EMAIL,
    role: "staff",
    userType: "staff"
  });

  return ok(res, { token, tokenType: "Bearer", expiresIn: 28800 });
});

biAppApplicantRoutes.post("/application/draft", async (req, res) => {
  const userPhone = (req.user as { phone?: string } | undefined)?.phone;
  const { data, createdBy } = req.body;

  if (!userPhone) {
    return badRequest(res, "Token phone claim is required");
  }

  let createdByActor = "applicant";
  let createdByLenderId = null;

  if (createdBy === "lender") {
    const lenderUser = await pool.query(
      "SELECT id FROM bi_users WHERE phone_e164=$1 AND user_type='lender'",
      [userPhone]
    );

    if (lenderUser.rows.length === 0) {
      return badRequest(res, "Lender not found");
    }

    const lender = await pool.query("SELECT id FROM bi_lenders WHERE user_id=$1", [lenderUser.rows[0].id]);

    if (lender.rows.length === 0) {
      return badRequest(res, "Lender profile not found");
    }

    createdByActor = "lender";
    createdByLenderId = lender.rows[0].id;
  }

  let companyId = null;
  if (data.client_name) {
    const companyInsert = await pool.query(
      `INSERT INTO bi_companies(legal_name)
       VALUES($1)
       RETURNING id`,
      [data.client_name]
    );
    companyId = companyInsert.rows[0].id;
  }

  let contactId = null;
  if (data.client_name) {
    const contactInsert = await pool.query(
      `INSERT INTO bi_contacts(full_name, phone_e164, company_id)
       VALUES($1, $2, $3)
       RETURNING id`,
      [data.client_name, data.client_phone || userPhone, companyId]
    );
    contactId = contactInsert.rows[0].id;
  }

  let premiumSnapshot = {};
  if (data.loanAmount && data.facilityType) {
    premiumSnapshot = calculatePremium({
      loanAmount: data.loanAmount,
      facilityType: data.facilityType,
    });
  }

  const created = await pool.query(
    `INSERT INTO bi_applications
    (
      created_by_actor,
      created_by_lender_id,
      applicant_phone_e164,
      company_id,
      primary_contact_id,
      data,
      premium_calc
    )
    VALUES($1,$2,$3,$4,$5,$6,$7)
    RETURNING *`,
    [createdByActor, createdByLenderId, data.client_phone || userPhone, companyId, contactId, data, premiumSnapshot]
  );

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
    VALUES($1,$2,'application_created',$3)`,
    [created.rows[0].id, createdByActor, `Application created by ${createdByActor}`]
  );

  return ok(res, created.rows[0]);
});

biAppApplicantRoutes.post("/application/submit", async (req, res) => {
  const { applicationId, facilityType, loanAmount, bankruptcy } = req.body;

  if (!applicationId || !facilityType || typeof loanAmount !== "number") {
    return badRequest(res, "applicationId, facilityType and loanAmount are required");
  }

  try {
    const premium = calculatePremium({ facilityType, loanAmount });

    const updatedApplication = await pool.query(
      `UPDATE bi_applications
       SET stage='documents_pending',
           bankruptcy_flag=$2,
           premium_calc=$3,
           updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [applicationId, bankruptcy || false, premium]
    );

    if (!updatedApplication.rows.length) {
      return badRequest(res, "Application not found");
    }

    await pool.query(
      `INSERT INTO bi_commissions(application_id,annual_premium_amount,commission_amount,status)
      VALUES($1,$2,$3,'estimated')
      ON CONFLICT (application_id) DO NOTHING`,
      [applicationId, premium.annualPremium, premium.annualPremium * 0.1]
    );

    await pool.query(
      `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
      VALUES($1,'applicant','application_submitted','Application submitted and moved to Documents Pending')`,
      [applicationId]
    );

    if (bankruptcy) {
      await pool.query(
        `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
        VALUES($1,'system','red_flag','Bankruptcy flag triggered')`,
        [applicationId]
      );
    }

    const pgiResult = await submitApplicationToPGI(applicationId);
    return ok(res, { success: true, premium, pgi: pgiResult });
  } catch (error) {
    console.error("Application submit failed", error);
    return badRequest(res, "Failed to submit application");
  }
});

export default publicRouter;
