import { Request, Response } from "express";
import { pool } from "../db";
import { z } from "zod";

const schema = z.object({
  leadId: z.string(),
  personalData: z.any(),
  companyData: z.any(),
  guaranteeData: z.any(),
  declarations: z.any(),
  consentData: z.any(),
  quoteResult: z.any()
});

export async function createApplication(req: Request, res: Response) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  const result = await pool.query(
    `INSERT INTO bi_applications
    (lead_id, personal_data, company_data, guarantee_data, declarations, consent_data, quote_result, status, submitted_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'submitted',NOW())
    RETURNING *`,
    [
      parsed.data.leadId,
      parsed.data.personalData,
      parsed.data.companyData,
      parsed.data.guaranteeData,
      parsed.data.declarations,
      parsed.data.consentData,
      parsed.data.quoteResult
    ]
  );

  res.json(result.rows[0]);
}
