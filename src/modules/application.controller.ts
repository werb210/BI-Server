import { Request, Response } from "express";
import { pool } from "../db";
import { z } from "zod";
import { generateRecurringCommission } from "./commission.service";

const schema = z.object({
  leadId: z.string(),
  personalData: z.any(),
  companyData: z.any(),
  guaranteeData: z.any(),
  declarations: z.any(),
  consentData: z.any(),
  quoteResult: z.object({
    estimatedPremium: z.number()
  }).passthrough(),
  referrerId: z.string().uuid().optional()
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

  await pool.query(
    `INSERT INTO bi_events(entity_type, entity_id, event_type)
     VALUES($1,$2,$3)`,
    ["application", result.rows[0].id, "submitted"]
  );

  if (parsed.data.referrerId) {
    await generateRecurringCommission(
      result.rows[0].id,
      parsed.data.quoteResult.estimatedPremium,
      0.15
    );
  }

  res.json(result.rows[0]);
}
