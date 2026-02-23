import { Request, Response } from "express";
import { pool } from "../db";

export async function purbeckWebhook(req: Request, res: Response) {
  const { externalId, status } = req.body;

  await pool.query("UPDATE bi_applications SET status=$1 WHERE id=$2", [status, externalId]);

  res.json({ received: true });
}
