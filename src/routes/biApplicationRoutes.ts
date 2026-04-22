import { Router } from "express";
import { pool } from "../db";
import { submitApplicationToPGI } from "../services/biPgiSubmissionService";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();

router.get("/applications", async (_req, res) => {
  const result = await pool.query(`
    SELECT a.id, a.stage, a.bankruptcy_flag, a.premium_calc, a.created_by_lender_id,
           c.full_name AS primary_contact_name
    FROM bi_applications a
    LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
    ORDER BY a.created_at DESC
  `);

  return ok(res, result.rows);
});

router.get("/pipeline", async (req, res) => {
  const stage = String(req.query.stage || "").trim();
  if (!stage) {
    return badRequest(res, "stage is required");
  }

  const result = await pool.query(
    `SELECT id, stage, created_at, updated_at, applicant_phone_e164, premium_calc
     FROM bi_applications
     WHERE stage = $1
     ORDER BY updated_at DESC`,
    [stage]
  );

  return ok(res, result.rows);
});

router.patch("/pipeline/:id/stage", async (req, res) => {
  const { id } = req.params;
  const { stage } = req.body as { stage?: string };
  const actor = (req.user as { staffUserId?: string } | undefined)?.staffUserId || null;

  if (!stage) {
    return badRequest(res, "stage is required");
  }

  await pool.query(`UPDATE bi_applications SET stage=$2, updated_at=NOW() WHERE id=$1`, [id, stage]);

  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, actor_user_id, event_type, summary, meta)
     VALUES($1, 'staff', $2, 'stage_change', $3, $4::jsonb)`,
    [id, actor, `Stage changed to ${stage}`, JSON.stringify({ stage })]
  );

  return ok(res, { success: true });
});

router.get("/applications/:id", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT a.*,
            c.full_name AS primary_contact_name,
            co.legal_name AS company_name,
            COALESCE(pa.data->>'status', a.stage::text) AS pgi_status
     FROM bi_applications a
     LEFT JOIN bi_contacts c ON c.id = a.primary_contact_id
     LEFT JOIN bi_companies co ON co.id = a.company_id
     LEFT JOIN pgi_applications pa ON pa.id = a.id OR pa.data->>'externalId' = a.pgi_external_id
     WHERE a.id=$1`,
    [id]
  );

  if (result.rows.length === 0) {
    return badRequest(res, "Not found");
  }

  const payload = {
    ...result.rows[0],
    pgiStatus: result.rows[0].pgi_status
  };
  delete payload.pgi_status;
  return ok(res, payload);
});

router.get("/applications/:id/documents", async (req, res) => {
  const { id } = req.params;
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  const result = await pool.query(
    `SELECT id, original_filename, created_at
     FROM bi_documents
     WHERE application_id=$1
       AND purged_at IS NULL
     ORDER BY created_at DESC`,
    [id]
  );

  const documents = result.rows.map((row) => ({
    id: row.id,
    file_name: row.original_filename,
    url: `${baseUrl}/api/v1/bi/documents/${row.id}`,
    uploaded_at: row.created_at
  }));

  return ok(res, documents);
});

router.post("/application/:id/submit-pgi", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await submitApplicationToPGI(id);
    return ok(res, { success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit to PGI";
    return badRequest(res, message);
  }
});

router.get("/applications/:id/activity", async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(`SELECT * FROM bi_activity WHERE application_id=$1 ORDER BY created_at DESC`, [id]);
  return ok(res, result.rows);
});

router.get("/applications/:id/requirements", async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(
    `SELECT id, application_id, label, status, created_at, updated_at
     FROM bi_requirements
     WHERE application_id=$1
     ORDER BY created_at DESC`,
    [id]
  );

  return ok(res, result.rows);
});

router.patch("/applications/:id/requirements/:reqId", async (req, res) => {
  const { id, reqId } = req.params;
  const { status } = req.body as { status?: "received" | "waived" | "rejected" | "pending" };

  if (!status) {
    return badRequest(res, "status is required");
  }

  const updated = await pool.query(
    `UPDATE bi_requirements
     SET status=$3, updated_at=NOW()
     WHERE id=$2 AND application_id=$1
     RETURNING *`,
    [id, reqId, status]
  );

  await pool.query(
    `INSERT INTO bi_requirements_history(requirement_id, application_id, old_status, new_status)
     VALUES($1, $2, NULL, $3)`,
    [reqId, id, status]
  );

  return ok(res, updated.rows[0] ?? null);
});

router.get("/application/by-phone", async (req, res) => {
  const { phone } = req.query;
  const result = await pool.query(
    `SELECT * FROM bi_applications
     WHERE applicant_phone_e164=$1
       AND stage IN ('new_application','documents_pending','under_review')
     ORDER BY created_at DESC
     LIMIT 1`,
    [phone]
  );

  return ok(res, result.rows[0] ?? null);
});

export default router;
