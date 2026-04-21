import { Router } from "express";
import { env } from "../platform/env";
import { pool } from "../db";
import { badRequest, ok } from "../utils/apiResponse";

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

  return ok(res, result.rows);
});

/* =========================
   GET APPLICATION DETAIL
========================= */
router.get("/applications/:id", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `
    SELECT
      a.*,
      c.full_name AS primary_contact_name,
      co.legal_name AS company_name
    FROM bi_applications a
    LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
    LEFT JOIN bi_companies co ON co.id = a.company_id
    WHERE a.id=$1
    `,
    [id]
  );

  if (result.rows.length === 0) {
    return badRequest(res, "Not found");
  }

  return ok(res, result.rows[0]);
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
    return ok(res, null);
  }

  return ok(res, result.rows[0]);
});

/* =========================
   LENDER – VIEW OWN APPLICATIONS
========================= */
router.get("/lender/applications", async (req, res) => {
  const { lenderUserId } = req.query;

  const lenderUser = await pool.query(
    `SELECT id FROM bi_users WHERE phone_e164=$1 AND user_type='lender'`,
    [lenderUserId]
  );

  if (lenderUser.rows.length === 0) {
    return ok(res, []);
  }

  const lender = await pool.query(`SELECT id FROM bi_lenders WHERE user_id=$1`, [lenderUser.rows[0].id]);

  if (lender.rows.length === 0) {
    return ok(res, []);
  }

  const apps = await pool.query(
    `
    SELECT 
      a.id,
      a.stage,
      a.bankruptcy_flag,
      a.premium_calc,
      c.full_name AS primary_contact_name
    FROM bi_applications a
    LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
    WHERE a.created_by_lender_id=$1
    ORDER BY a.created_at DESC
    `,
    [lender.rows[0].id]
  );

  return ok(res, apps.rows);
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

  return ok(res, result.rows);
});

/* =========================
   GET APPLICATION DOCUMENTS
========================= */
router.get("/applications/:id/documents", async (req, res) => {
  const { id } = req.params;

  const docs = await pool.query(
    `
    SELECT id,
           original_filename,
           mime_type,
           bytes,
           created_at
    FROM bi_documents
    WHERE application_id=$1
      AND purged_at IS NULL
    ORDER BY created_at DESC
    `,
    [id]
  );

  return ok(res, docs.rows);
});

router.post("/applications/:id/stage", async (req, res) => {
  const { id } = req.params;
  const { stage, actorType, actorUserId } = req.body;

  // Optional lender ownership check
  if (actorType === "lender") {
    const lender = await pool.query(`SELECT id FROM bi_lenders WHERE user_id=$1`, [actorUserId]);

    if (lender.rows.length === 0) {
      return badRequest(res, "Not authorized");
    }

    const ownership = await pool.query(
      `SELECT id FROM bi_applications
       WHERE id=$1 AND created_by_lender_id=$2`,
      [id, lender.rows[0].id]
    );

    if (ownership.rows.length === 0) {
      return badRequest(res, "Forbidden");
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
    const bufferDays = Number(process.env.PURGE_BUFFER_DAYS || "30");

    await pool.query(
      `
      INSERT INTO bi_purge_queue(application_id, eligible_at)
      VALUES($1, NOW() + ($2::text || ' days')::interval)
      ON CONFLICT (application_id) DO NOTHING
    `,
      [id, bufferDays]
    );
  }

  return ok(res, { success: true });
});

export default router;
