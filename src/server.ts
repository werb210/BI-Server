import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { z } from "zod";
import { Pool } from "pg";
import cron from "node-cron";
import nodemailer from "nodemailer";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL missing");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const app = express();
app.use(cors());
app.use(express.json());

const Schema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  loanAmount: z.number().positive(),
  securedType: z.enum(["secured", "unsecured"]),
  hasBankruptcy: z.boolean(),
  hasExistingPG: z.boolean(),
  existingPGAmount: z.number().optional(),
  hasPreviousClaims: z.boolean(),
  directors: z.array(
    z.object({
      name: z.string(),
      ownership: z.string()
    })
  )
});

function calculate(loanAmount: number, securedType: string) {
  const insuredAmount = Math.min(loanAmount * 0.8, 1400000);
  const rate = securedType === "secured" ? 0.016 : 0.04;
  const premium = insuredAmount * rate;
  const commission = premium * 0.1;

  return { insuredAmount, premium, commission };
}

app.post("/api/applications", async (req, res) => {
  try {
    const parsed = Schema.parse(req.body);

    const calc = calculate(parsed.loanAmount, parsed.securedType);

    const result = await pool.query(
      `
      INSERT INTO bi_applications
      (first_name, last_name, email,
       loan_amount, secured_type,
       insured_amount, annual_premium, commission,
       has_bankruptcy, has_existing_pg,
       existing_pg_amount, has_previous_claims,
       directors, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')
      RETURNING id
      `,
      [
        parsed.firstName,
        parsed.lastName,
        parsed.email,
        parsed.loanAmount,
        parsed.securedType,
        calc.insuredAmount,
        calc.premium,
        calc.commission,
        parsed.hasBankruptcy,
        parsed.hasExistingPG,
        parsed.existingPGAmount || null,
        parsed.hasPreviousClaims,
        JSON.stringify(parsed.directors)
      ]
    );

    await transporter.sendMail({
      from: `"Boreal Insurance" <${process.env.SMTP_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: "New BI Application Submitted",
      html: `
        <h2>New Application</h2>
        <p>Name: ${parsed.firstName} ${parsed.lastName}</p>
        <p>Email: ${parsed.email}</p>
        <p>Loan Amount: $${parsed.loanAmount}</p>
        <p>Type: ${parsed.securedType}</p>
      `
    });

    await transporter.sendMail({
      from: `"Boreal Insurance" <${process.env.SMTP_USER}>`,
      to: parsed.email,
      subject: "Application Received",
      html: `
        <h2>Thank You</h2>
        <p>Your Personal Guarantee Insurance application has been received.</p>
        <p>We will contact you shortly.</p>
      `
    });

    res.json({
      success: true,
      id: result.rows[0].id
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(400).json({ error: "Unknown error" });
  }
});

/**
 * Create initial commission ledger entry when application approved
 */
app.post("/internal/create-ledger/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const appResult = await pool.query("SELECT * FROM bi_applications WHERE id=$1", [
      id
    ]);

    const appData = appResult.rows[0];
    if (!appData) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const renewalDate = new Date();
    renewalDate.setFullYear(renewalDate.getFullYear() + 1);

    await pool.query(
      `
      INSERT INTO bi_commission_ledger
      (application_id, policy_year, insured_amount,
       annual_premium, commission, renewal_date)
      VALUES ($1,1,$2,$3,$4,$5)
      `,
      [
        id,
        appData.insured_amount,
        appData.annual_premium,
        appData.commission,
        renewalDate
      ]
    );

    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(500).json({ error: err.message });
      return;
    }

    res.status(500).json({ error: "Unknown error" });
  }
});

/**
 * Renewal Check (daily)
 */
cron.schedule("0 3 * * *", async () => {
  const result = await pool.query(
    `
    SELECT * FROM bi_commission_ledger
    WHERE renewal_date <= NOW() AND paid=true
    `
  );

  for (const entry of result.rows) {
    const nextYear = entry.policy_year + 1;
    const nextRenewal = new Date(entry.renewal_date);
    nextRenewal.setFullYear(nextRenewal.getFullYear() + 1);

    await pool.query(
      `
      INSERT INTO bi_commission_ledger
      (application_id, policy_year, insured_amount,
       annual_premium, commission, renewal_date)
      VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [
        entry.application_id,
        nextYear,
        entry.insured_amount,
        entry.annual_premium,
        entry.commission,
        nextRenewal
      ]
    );
  }
});

app.listen(process.env.PORT || 4000, () => console.log("BI Server running"));
