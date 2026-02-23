import { Request, Response } from "express";
import { pool } from "../db";

export async function cancelPolicy(req: Request, res: Response) {
  const { id } = req.params;

  await pool.query("UPDATE bi_policies SET status='cancelled' WHERE id=$1", [id]);

  res.json({ cancelled: true });
}
