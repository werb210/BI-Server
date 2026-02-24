import { Router } from "express";
import { Pool } from "pg";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

router.get("/commissions", async (_req, res) => {
  const result = await pool.query(`
    SELECT id,
           application_id,
           annual_premium_amount,
           commission_amount,
           status
    FROM bi_commissions
    ORDER BY created_at DESC
  `);

  res.json(result.rows);
});

/* =========================
   MARK PREMIUM RECEIVED
========================= */
router.post("/commissions/:id/premium-received", async (req, res) => {
  const { id } = req.params;

  await pool.query(
    `
    UPDATE bi_commissions
    SET premium_received_at = NOW(),
        status = 'payable'
    WHERE id = $1
  `,
    [id]
  );

  res.json({ success: true });
});

export default router;
