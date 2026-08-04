import { Router } from "express";
import { Pool } from "pg";
import { env } from "../platform/env";

import { ok } from "../utils/apiResponse";

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

router.get("/by-application/:id", async (req, res) => {
  const result = await db.query(
    `SELECT * FROM bi_commissions WHERE application_id=$1 LIMIT 1`,
    [req.params.id]
  );
  return ok(res, result.rows[0] ?? null);
});

router.post("/:id/premium-received", async (req, res) => {

  const { id } = req.params;

  // BI_SERVER_LIVE_SCHEMA_COLUMNS_v5
  // There is no `received` boolean on bi_commissions. The live table records
  // this as status plus a premium_received_at timestamp, which is also what
  // biReportRoutes reads when it totals payable commission - so this route
  // 500'd, and had it succeeded it would still not have moved the number the
  // report shows.
  await db.query(
    `UPDATE bi_commissions
        SET status = 'received',
            premium_received_at = COALESCE(premium_received_at, NOW()),
            updated_at = NOW()
      WHERE id = $1`,
    [id]
  );

  ok(res, { success: true });

});

export default router;
