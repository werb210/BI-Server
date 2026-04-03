import { Router } from "express";
import { pool } from "../db";

import { badRequest, ok } from "../utils/apiResponse";

const router = Router();

router.post("/events", async (req, res) => {
  try {
    const { applicationId, eventType, metadata } = req.body;

    if (!applicationId || !eventType) {
      return badRequest(res, "Missing required fields");
    }

    await pool.query(
      `
      INSERT INTO bi_crm_events (application_id, event_type, metadata)
      VALUES ($1, $2, $3)
      `,
      [applicationId, eventType, metadata || {}]
    );

    await pool.query(
      `
      INSERT INTO bi_crm_activities (application_id, activity_type, description)
      VALUES ($1, $2, $3)
      `,
      [applicationId, eventType, `Event recorded: ${eventType}`]
    );

    return ok(res, { success: true });
  } catch (err) {
    console.error("BI CRM event error:", err);
    return badRequest(res, "Internal error");
  }
});

export default router;
