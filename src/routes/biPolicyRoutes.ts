import { Router } from "express";
import { Pool } from "pg";
import { env } from "../platform/env";

import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const db = new Pool({ connectionString: env.DATABASE_URL });

router.post("/:id/activate", async (req, res) => {
  const { id } = req.params;

  const result = await db.query(
    `UPDATE bi_applications
     SET stage='active'
     WHERE id=$1
     RETURNING *`,
    [id]
  );

  ok(res, result.rows[0]);
});

router.post("/:id/cancel", async (req, res) => {
  const { id } = req.params;

  await db.query(
    `UPDATE bi_applications
     SET stage='cancelled'
     WHERE id=$1`,
    [id]
  );

  ok(res, { success: true });
});

router.post("/:id/renew", async (req, res) => {
  const { id } = req.params;

  await db.query(
    `UPDATE bi_applications
     SET stage='renewed'
     WHERE id=$1`,
    [id]
  );

  ok(res, { success: true });
});

export default router;
