import { Request, Response } from "express";
import { pool } from "../db";

export async function submitClaim(req: Request, res: Response) {
  const { policyId, amount } = req.body;

  const claim = await pool.query(
    `INSERT INTO bi_claims (policy_id, claim_amount)
     VALUES ($1,$2)
     RETURNING *`,
    [policyId, amount]
  );

  res.json(claim.rows[0]);
}
