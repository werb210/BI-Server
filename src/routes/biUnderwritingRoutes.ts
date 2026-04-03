import { Router } from "express";
import { Pool } from "pg";
import { env } from "../platform/env";

import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const db = new Pool({ connectionString: env.DATABASE_URL });

router.post("/:id/status", async (req, res) => {

  const { id } = req.params;
  const { status } = req.body;

  await db.query(
    `UPDATE bi_applications
     SET stage=$2
     WHERE id=$1`,
    [id, status]
  );

  ok(res, { success: true });

});

export default router;
