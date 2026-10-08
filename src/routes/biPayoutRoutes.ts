import { Router } from "express";
import { pool as sharedPool } from "../db"; // BI_SERVER_ONE_POOL_v718 - one pool for the whole server
import { env } from "../platform/env";

import { badRequest, ok } from "../utils/apiResponse";

const router = Router();
const db = sharedPool /* BI_SERVER_ONE_POOL_v718 */;

router.post("/create-batch", async (_req, res) => {

  const batch = await db.query(`
    INSERT INTO bi_payout_batches(id, created_at)
    VALUES (gen_random_uuid(), now())
    RETURNING *
  `);

  ok(res, batch.rows[0]);

});

router.post("/:batchId/pay", async (req, res) => {

  const { batchId } = req.params;

  await db.query(
    `UPDATE bi_commission_payables
     SET paid=true
     WHERE batch_id=$1`,
    [batchId]
  );

  ok(res, { success: true });

});

export default router;
