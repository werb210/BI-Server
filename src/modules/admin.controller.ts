import { Request, Response } from "express";
import { pool } from "../db";

export async function getApplications(req: Request, res: Response) {
  const status = req.query.status;
  let query = "SELECT * FROM bi_applications";
  const values: string[] = [];

  if (status && typeof status === "string") {
    query += " WHERE status=$1";
    values.push(status);
  }

  query += " ORDER BY created_at DESC";

  const result = await pool.query(query, values);
  res.json(result.rows);
}

export async function getCommissions(_: Request, res: Response) {
  const result = await pool.query(
    "SELECT * FROM bi_commissions ORDER BY created_at DESC"
  );
  res.json(result.rows);
}
