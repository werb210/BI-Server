import cron from "node-cron";
import { pool } from "../db";
import { logger } from "../platform/logger";

const bufferDays = Number(process.env.PURGE_BUFFER_DAYS || "30");
const terminalStages = ["declined", "policy_issued", "bound", "claim"];

export function startPurgeJob() {
  cron.schedule("0 3 * * *", async () => {
    logger.info({ bufferDays }, "Running BI document purge job");

    const eligible = await pool.query(
      `SELECT q.application_id
       FROM bi_purge_queue q
       JOIN bi_applications a ON a.id = q.application_id
       WHERE q.eligible_at <= (NOW() - ($1 * INTERVAL '1 day'))
         AND q.purged_at IS NULL
         AND a.stage = ANY($2::bi_pipeline_stage[])`,
      [bufferDays, terminalStages]
    );

    for (const row of eligible.rows) {
      await pool.query(`UPDATE bi_documents SET purged_at=NOW() WHERE application_id=$1`, [row.application_id]);
      await pool.query(`UPDATE bi_purge_queue SET purged_at=NOW() WHERE application_id=$1`, [row.application_id]);
    }
  });
}
