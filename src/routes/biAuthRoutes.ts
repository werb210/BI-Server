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
  const { phone, data } = req.body;

  if (!phone) {
    return res.status(400).json({ error: "Phone required" });
  }

  try {
    const existing = await pool.query(
      `SELECT * FROM bi_applications
       WHERE applicant_phone_e164=$1
       AND stage='new_application'
       LIMIT 1`,
      [phone]
    );

    if (existing.rows.length === 0) {
      const created = await pool.query(
        `INSERT INTO bi_applications
         (created_by_actor,applicant_phone_e164,data)
         VALUES('applicant',$1,$2)
         RETURNING *`,
        [phone, data ?? {}]
      );

      return res.json(created.rows[0]);
    }

    const updated = await pool.query(
      `UPDATE bi_applications
       SET data=$2,
           updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [existing.rows[0].id, data ?? {}]
    );

    return res.json(updated.rows[0]);
  } catch (error) {
    console.error("Draft upsert failed", error);
    return res.status(500).json({ error: "Failed to save draft" });
  }
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

    return res.json({ success: true, premium });
  } catch (error) {
    console.error("Application submit failed", error);
    return res.status(500).json({ error: "Failed to submit application" });
  }
});

export default router;
