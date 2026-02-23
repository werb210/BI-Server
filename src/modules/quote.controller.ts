import { Request, Response } from "express";
import { z } from "zod";
import { calculatePremium } from "./quote.service";
import { pool } from "../db";

const schema = z.object({
  guaranteeAmount: z.number().positive(),
  termMonths: z.number().positive(),
  email: z.string().email().optional(),
  source: z.string().default("direct")
});

export async function quoteHandler(req: Request, res: Response) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  const result = calculatePremium(
    parsed.data.guaranteeAmount,
    parsed.data.termMonths
  );

  const lead = await pool.query(
    `INSERT INTO bi_leads (source, email)
     VALUES ($1,$2)
     RETURNING id`,
    [parsed.data.source, parsed.data.email || null]
  );

  res.json({
    leadId: lead.rows[0].id,
    ...result
  });
}
