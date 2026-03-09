import { Router } from "express";
import { Pool } from "pg";

const router = Router();
const db = new Pool({ connectionString: process.env.DATABASE_URL });

router.get("/", async (_req, res) => {

  const result = await db.query(`
    SELECT *
    FROM bi_commissions
    ORDER BY created_at DESC
  `);

  res.json(result.rows);

});

router.post("/:id/premium-received", async (req, res) => {

  const { id } = req.params;

  await db.query(
    `UPDATE bi_commissions
     SET received=true
     WHERE id=$1`,
    [id]
  );

  res.json({ success: true });

});

export default router;
