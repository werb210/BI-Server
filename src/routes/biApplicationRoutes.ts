import { Router } from "express";
import { pool } from "../db";

const router = Router();

router.get("/applications", async (_req, res) => {
  const result = await pool.query(`
    SELECT
      a.id,
      a.stage,
      a.bankruptcy_flag,
      a.premium_calc,
      c.full_name AS primary_contact_name
    FROM bi_applications a
    LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
    ORDER BY a.created_at DESC
  `);

  return res.json(result.rows);
});

router.get("/applications/:id/activity", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `
    SELECT *
    FROM bi_activity
    WHERE application_id=$1
    ORDER BY created_at DESC
  `,
    [id]
  );

  return res.json(result.rows);
});

router.post("/applications/:id/stage", async (req, res) => {
  const { id } = req.params;
  const { stage, actorType, actorUserId } = req.body;

  await pool.query(
    `
    UPDATE bi_applications
    SET stage=$2
    WHERE id=$1
  `,
    [id, stage]
  );

  await pool.query(
    `
    INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary)
    VALUES($1,$2,$3,'stage_change',$4)
  `,
    [id, actorType || "staff", actorUserId || null, `Stage changed to ${stage}`]
  );

  if (["approved", "declined", "policy_issued"].includes(stage)) {
    const bufferDays = Number(process.env.PURGE_BUFFER_DAYS || 30);

    await pool.query(
      `
      INSERT INTO bi_purge_queue(application_id, eligible_at)
      VALUES($1, NOW() + ($2::text || ' days')::interval)
      ON CONFLICT (application_id) DO NOTHING
    `,
      [id, bufferDays]
    );
  }

  return res.json({ success: true });
});

export default router;
