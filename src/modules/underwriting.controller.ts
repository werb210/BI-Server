import { Request, Response } from "express";
import { pool } from "../db";

export async function updateUnderwritingStatus(req: Request, res: Response) {
  const { id } = req.params;
  const { status } = req.body;

  await pool.query("UPDATE bi_applications SET status=$1 WHERE id=$2", [status, id]);

  await pool.query(
    `INSERT INTO bi_events(entity_type, entity_id, event_type)
     VALUES($1,$2,$3)`,
    ["application", id, status]
  );

  res.json({ success: true });
}
