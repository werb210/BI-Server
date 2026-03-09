import { Router } from "express";
import { Pool } from "pg";

const router = Router();
const db = new Pool({ connectionString: process.env.DATABASE_URL });

router.post("/:id/status", async (req, res) => {

  const { id } = req.params;
  const { status } = req.body;

  await db.query(
    `UPDATE bi_applications
     SET stage=$2
     WHERE id=$1`,
    [id, status]
  );

  res.json({ success: true });

});

export default router;
