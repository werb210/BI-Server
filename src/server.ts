import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { z } from "zod";
import { Pool } from "pg";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL missing");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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

app.listen(process.env.PORT || 4000, () => console.log("BI Server running"));
