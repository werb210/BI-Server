import cron from "node-cron";
import { pool } from "../db";

const bufferDays = Number(process.env.PURGE_BUFFER_DAYS || 30);

export function startPurgeJob() {
  cron.schedule("0 3 * * *", async () => {
    console.log(`Running BI document purge job (bufferDays=${bufferDays})...`);

    const eligible = await pool.query(
      `SELECT application_id
       FROM bi_purge_queue
       WHERE eligible_at <= (NOW() - ($1 * INTERVAL '1 day'))
       AND purged_at IS NULL`,
      [bufferDays]
    );

    for (const row of eligible.rows) {
      await pool.query(
        `UPDATE bi_documents
         SET purged_at=NOW()
         WHERE application_id=$1`,
        [row.application_id]
      );

      await pool.query(
        `UPDATE bi_purge_queue
         SET purged_at=NOW()
         WHERE application_id=$1`,
        [row.application_id]
      );
    }
  });
}
