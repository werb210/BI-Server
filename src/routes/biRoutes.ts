import { Router } from "express";
import sgMail from "@sendgrid/mail";
import { pool } from "../db";
import { ENV } from "../config/env";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();

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
