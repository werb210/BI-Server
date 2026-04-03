import { Router } from "express";
import { Pool } from "pg";
import { env } from "../platform/env";

import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const db = new Pool({ connectionString: env.DATABASE_URL });

router.get("/", async (_req, res) => {

  const result = await db.query(`
    SELECT *
    FROM bi_commissions
    ORDER BY created_at DESC
  `);

  ok(res, result.rows);

});

router.post("/:id/premium-received", async (req, res) => {

  const { id } = req.params;

  await db.query(
    `UPDATE bi_commissions
     SET received=true
     WHERE id=$1`,
    [id]
  );

  ok(res, { success: true });

});

export default router;
