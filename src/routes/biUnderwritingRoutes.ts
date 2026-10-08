import { Router } from "express";
import { pool as sharedPool } from "../db"; // BI_SERVER_ONE_POOL_v718 - one pool for the whole server
import { env } from "../platform/env";

import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const db = sharedPool /* BI_SERVER_ONE_POOL_v718 */;

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
