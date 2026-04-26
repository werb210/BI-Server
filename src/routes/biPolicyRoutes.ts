import { Router } from "express";
import { Pool } from "pg";
import { env } from "../platform/env";

import { ok } from "../utils/apiResponse";

const router = Router();
const db = new Pool({ connectionString: env.DATABASE_URL });

router.post("/:id/activate", async (req, res) => {
  const { id } = req.params;

  const result = await db.query(
    `UPDATE bi_applications
     SET stage='policy_issued',
         updated_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [id]
  );

  await db.query(
    `INSERT INTO bi_policies(application_id, status)
     VALUES($1, 'active')
     ON CONFLICT DO NOTHING`,
    [id]
  );

  await db.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
     VALUES($1,'system','policy_activated','Policy activated')`,
    [id]
  );

  ok(res, result.rows[0] ?? null);
});

router.post("/:id/cancel", async (req, res) => {
  const { id } = req.params;
  await db.query(
    "UPDATE bi_policies SET status='cancelled' WHERE id=$1",
    [id]
  );
  await db.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
     SELECT application_id, 'staff', 'policy_cancelled', 'Policy cancelled', '{}'::jsonb
       FROM bi_policies WHERE id=$1`,
    [id]
  );
  ok(res, { success: true });
});

router.post("/:id/renew", async (req, res) => {
  const { id } = req.params;
  await db.query(
    `UPDATE bi_policies
        SET start_date = end_date,
            end_date   = end_date + INTERVAL '1 year'
      WHERE id=$1`,
    [id]
  );
  await db.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
     SELECT application_id, 'staff', 'policy_renewed', 'Policy renewed', '{}'::jsonb
       FROM bi_policies WHERE id=$1`,
    [id]
  );
  ok(res, { success: true });
});

export default router;
