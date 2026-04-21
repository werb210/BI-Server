import { Request, Response } from "express";
import { pool } from "../db";

export function mapStatus(status: string) {
  switch (status) {
    case "submitted":
      return "Application Submitted";
    case "under_review":
      return "Under Review";
    case "approved":
      return "Approved";
    case "policy_issued":
      return "Policy Issued";
    case "declined":
      return "Declined";
    default:
      return "Unknown";
  }
}

export async function handlePGIWebhook(req: Request, res: Response) {
  try {
    const event = req.body as { id?: string; status?: string };

    const externalId = event.id;
    const status = event.status || "";

    if (!externalId) {
      return res.status(400).send("missing id");
    }

    const mapped = mapStatus(status);

    const found = await pool.query(
      `SELECT id, data
       FROM pgi_applications
       WHERE data->>'externalId' = $1 OR id::text = $1
       LIMIT 1`,
      [externalId]
    );

    if (found.rows.length > 0) {
      const row = found.rows[0] as { id: string; data: Record<string, unknown> };
      const existingTimeline = Array.isArray(row.data.timeline) ? row.data.timeline : [];
      const updated = {
        ...row.data,
        status: mapped,
        stage: mapped,
        externalId,
        updatedAt: new Date().toISOString(),
        timeline: [...existingTimeline, { stage: mapped, timestamp: new Date().toISOString() }]
      };

      await pool.query("UPDATE pgi_applications SET data=$2::jsonb WHERE id=$1", [row.id, JSON.stringify(updated)]);
    }

    console.log("Webhook received:", externalId, mapped);

    return res.status(200).json({ ok: true, mappedStatus: mapped });
  } catch (err) {
    console.error("Webhook error", err);
    return res.status(500).send("error");
  }
}
