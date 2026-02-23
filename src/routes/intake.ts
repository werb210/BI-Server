import { Router } from "express";
import { pool } from "../db";

const router = Router();

router.post("/pgi-intake", async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      businessName,
      loanAmount,
      referralCode,
      utm_source,
      utm_medium,
      utm_campaign
    } = req.body;

    if (!email || !businessName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await pool.query(
      `
      INSERT INTO pgi_applications (
        first_name,
        last_name,
        email,
        phone,
        business_name,
        loan_amount,
        referral_code,
        utm_source,
        utm_medium,
        utm_campaign
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        firstName ?? null,
        lastName ?? null,
        email,
        phone ?? null,
        businessName,
        loanAmount ?? null,
        referralCode ?? null,
        utm_source ?? null,
        utm_medium ?? null,
        utm_campaign ?? null
      ]
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
