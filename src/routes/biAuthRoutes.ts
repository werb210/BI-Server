import { Router } from "express";
import { pool } from "../db";
import { sendOtp, verifyOtp } from "../services/otpService";
import { calculatePremium } from "../services/premiumService";

const router = Router();

router.post("/otp/request", async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: "Phone required" });
  }

  try {
    await sendOtp(phone);

    await pool.query(
      `INSERT INTO bi_otp_sessions(phone_e164,purpose)
       VALUES($1,'login')`,
      [phone]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("OTP request failed", error);
    return res.status(500).json({ error: "Failed to request OTP" });
  }
});

router.post("/otp/verify", async (req, res) => {
  const { phone, code, userType } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ error: "Phone and code required" });
  }

  try {
    const approved = await verifyOtp(phone, code);

    if (!approved) {
      return res.status(401).json({ error: "Invalid code" });
    }

    let user = await pool.query(`SELECT * FROM bi_users WHERE phone_e164=$1`, [phone]);

    if (user.rows.length === 0) {
      user = await pool.query(
        `INSERT INTO bi_users(phone_e164,user_type)
         VALUES($1,$2)
         RETURNING *`,
        [phone, userType || "applicant"]
      );
    }

    return res.json({ success: true, userId: user.rows[0].id });
  } catch (error) {
    console.error("OTP verification failed", error);
    return res.status(500).json({ error: "Failed to verify OTP" });
  }
});

router.post("/application/draft", async (req, res) => {
  const { phone, data, createdBy } = req.body;

  let createdByActor = "applicant";
  let createdByLenderId = null;

  // If created by lender
  if (createdBy === "lender") {
    // find lender user
    const lenderUser = await pool.query(
      `SELECT id FROM bi_users WHERE phone_e164=$1 AND user_type='lender'`,
      [phone]
    );

    if (lenderUser.rows.length === 0) {
      return res.status(403).json({ error: "Lender not found" });
    }

    const lender = await pool.query(`SELECT id FROM bi_lenders WHERE user_id=$1`, [lenderUser.rows[0].id]);

    if (lender.rows.length === 0) {
      return res.status(403).json({ error: "Lender profile not found" });
    }

    createdByActor = "lender";
    createdByLenderId = lender.rows[0].id;
  }

  // Create company record (if client provided name)
  let companyId = null;
  if (data.client_name) {
    const companyInsert = await pool.query(
      `
      INSERT INTO bi_companies(legal_name)
      VALUES($1)
      RETURNING id
      `,
      [data.client_name]
    );
    companyId = companyInsert.rows[0].id;
  }

  // Create contact
  let contactId = null;
  if (data.client_name) {
    const contactInsert = await pool.query(
      `
      INSERT INTO bi_contacts(full_name,phone_e164,company_id)
      VALUES($1,$2,$3)
      RETURNING id
      `,
      [data.client_name, data.client_phone || phone, companyId]
    );
    contactId = contactInsert.rows[0].id;
  }

  // Calculate premium immediately if loanAmount exists
  let premiumSnapshot = {};
  if (data.loanAmount && data.facilityType) {
    const { calculatePremium: calculateDraftPremium } = await import("../services/premiumService");
    premiumSnapshot = calculateDraftPremium({
      loanAmount: data.loanAmount,
      facilityType: data.facilityType,
    });
  }

  const created = await pool.query(
    `
    INSERT INTO bi_applications
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
    RETURNING *
    `,
    [createdByActor, createdByLenderId, data.client_phone || phone, companyId, contactId, data, premiumSnapshot]
  );

  await pool.query(
    `
    INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
    VALUES($1,$2,'application_created',$3)
    `,
    [created.rows[0].id, createdByActor, `Application created by ${createdByActor}`]
  );

  res.json(created.rows[0]);
});

router.post("/application/submit", async (req, res) => {
  const { applicationId, facilityType, loanAmount, bankruptcy } = req.body;

  if (!applicationId || !facilityType || typeof loanAmount !== "number") {
    return res.status(400).json({ error: "applicationId, facilityType and loanAmount are required" });
  }

  try {
    const premium = calculatePremium({ facilityType, loanAmount });

    await pool.query(
      `UPDATE bi_applications
       SET stage='documents_pending',
           bankruptcy_flag=$2,
           premium_calc=$3,
           updated_at=NOW()
       WHERE id=$1`,
      [applicationId, bankruptcy || false, premium]
    );

    await pool.query(
      `
      INSERT INTO bi_commissions(application_id,annual_premium_amount,commission_amount,status)
      VALUES($1,$2,$3,'estimated')
      ON CONFLICT (application_id) DO NOTHING
      `,
      [applicationId, premium.annualPremium, premium.annualPremium * 0.1]
    );

    await pool.query(
      `
      INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
      VALUES($1,'applicant','application_submitted','Application submitted and moved to Documents Pending')
    `,
      [applicationId]
    );

    if (bankruptcy) {
      await pool.query(
        `
        INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
        VALUES($1,'system','red_flag','Bankruptcy flag triggered')
      `,
        [applicationId]
      );
    }

    return res.json({ success: true, premium });
  } catch (error) {
    console.error("Application submit failed", error);
    return res.status(500).json({ error: "Failed to submit application" });
  }
});

export default router;
