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
      a.created_by_lender_id,
      c.full_name AS primary_contact_name
    FROM bi_applications a
    LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
    ORDER BY a.created_at DESC
  `);

  return res.json(result.rows);
});

/* =========================
   GET APPLICATION BY PHONE (RESUME)
========================= */
router.get("/application/by-phone", async (req, res) => {
  const { phone } = req.query;

  const result = await pool.query(
    `
    SELECT *
    FROM bi_applications
    WHERE applicant_phone_e164=$1
    AND stage IN ('new_application','documents_pending')
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [phone]
  );

  if (result.rows.length === 0) {
    return res.json(null);
  }

  return res.json(result.rows[0]);
});

/* =========================
   LENDER – VIEW OWN APPLICATIONS
========================= */
router.get("/lender/applications", async (req, res) => {
  const { lenderUserId } = req.query;

  if (!lenderUserId) {
    return res.status(400).json({ error: "Missing lenderUserId" });
  }

  const lenderResult = await pool.query(`SELECT id FROM bi_lenders WHERE user_id=$1`, [lenderUserId]);

  if (lenderResult.rows.length === 0) {
    return res.json([]);
  }

  const lenderId = lenderResult.rows[0].id;

  const apps = await pool.query(
    `
    SELECT
      a.id,
      a.stage,
      a.premium_calc,
      a.bankruptcy_flag,
      c.full_name AS primary_contact_name
    FROM bi_applications a
    LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
    WHERE a.created_by_lender_id=$1
    ORDER BY a.created_at DESC
    `,
    [lenderId]
  );

  return res.json(apps.rows);
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

  // Optional lender ownership check
  if (actorType === "lender") {
    const lender = await pool.query(`SELECT id FROM bi_lenders WHERE user_id=$1`, [actorUserId]);

    if (lender.rows.length === 0) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const ownership = await pool.query(
      `SELECT id FROM bi_applications
       WHERE id=$1 AND created_by_lender_id=$2`,
      [id, lender.rows[0].id]
    );

    if (ownership.rows.length === 0) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

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
