import { Request, Response } from "express";
import { pool } from "../db";

export async function submitClaim(req: Request, res: Response) {
  const { policyId, amount } = req.body;

  const policy = await pool.query(
    `SELECT status FROM bi_policies WHERE id=$1`,
    [policyId]
  );

  if (policy.rows[0]?.status !== "active") {
    return res.status(400).json({ error: "Policy not active" });
  }

  const claim = await pool.query(
    `INSERT INTO bi_claims (policy_id, claim_amount)
     VALUES ($1,$2)
     RETURNING *`,
    [policyId, amount]
  );

  res.json(claim.rows[0]);
}
