import { Router } from "express";
import { Pool } from "pg";

const router = Router();
const db = new Pool({ connectionString: process.env.DATABASE_URL });

router.post("/create-batch", async (_req, res) => {

  const batch = await db.query(`
    INSERT INTO bi_payout_batches(id, created_at)
    VALUES (gen_random_uuid(), now())
    RETURNING *
  `);

  res.json(batch.rows[0]);

});

router.post("/:batchId/pay", async (req, res) => {

  const { batchId } = req.params;

  await db.query(
    `UPDATE bi_commission_payables
     SET paid=true
     WHERE batch_id=$1`,
    [batchId]
  );

  res.json({ success: true });

});

export default router;
