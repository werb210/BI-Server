import { Request, Response } from "express";
import { pool } from "../db";

export async function getApplications(_: Request, res: Response) {
  const result = await pool.query(
    "SELECT * FROM bi_applications ORDER BY created_at DESC"
  );
  res.json(result.rows);
}

export async function getCommissions(_: Request, res: Response) {
  const result = await pool.query(
    "SELECT * FROM bi_commissions ORDER BY created_at DESC"
  );
  res.json(result.rows);
}
