import { pool } from "../db";

export async function runPremiumAccrual() {
  const client = await pool.connect();
  let lockAcquired = false;
  let jobId: string | undefined;

  try {
    await client.query("BEGIN");

    const lock = await client.query(
      `INSERT INTO bi_job_locks(job_name, locked_at)
       VALUES('premium_accrual', NOW())
       ON CONFLICT (job_name) DO NOTHING
       RETURNING job_name`
    );

    if (lock.rowCount === 0) {
      await client.query("ROLLBACK");
      return;
    }

    lockAcquired = true;

    const job = await client.query<{ id: string }>(
      `INSERT INTO bi_jobs(job_type, status, started_at)
       VALUES('premium_accrual','running',NOW())
       RETURNING id`
    );

    jobId = job.rows[0]?.id;

    const due = await client.query<{ id: string; premium_amount: string }>(
      `SELECT id, premium_amount
       FROM bi_premium_schedule
       WHERE due_date <= NOW() AND paid = false`
    );

    for (const row of due.rows) {
      await client.query(
        `UPDATE bi_premium_schedule
         SET paid = true
         WHERE id = $1`,
        [row.id]
      );

      await client.query(
        `INSERT INTO bi_ledger(entity_type, entity_id, transaction_type, amount)
         VALUES('premium', $1, 'premium_paid', $2)`,
        [row.id, row.premium_amount]
      );
    }

    await client.query(
      `UPDATE bi_jobs
       SET status='completed', completed_at=NOW()
       WHERE id=$1`,
      [jobId]
    );

    await client.query(`DELETE FROM bi_job_locks WHERE job_name='premium_accrual'`);
    lockAcquired = false;

    await client.query("COMMIT");
  } catch (err: any) {
    await client.query("ROLLBACK");

    if (jobId) {
      await client.query(
        `INSERT INTO bi_jobs(id, job_type, status, started_at, completed_at, error)
         VALUES($1, 'premium_accrual', 'failed', NOW(), NOW(), $2)
         ON CONFLICT (id) DO UPDATE
         SET status = 'failed', completed_at = NOW(), error = EXCLUDED.error`,
        [jobId, err?.message ?? "Unknown error"]
      );
    } else {
      await client.query(
        `INSERT INTO bi_jobs(job_type, status, started_at, completed_at, error)
         VALUES('premium_accrual', 'failed', NOW(), NOW(), $1)`,
        [err?.message ?? "Unknown error"]
      );
    }

    if (lockAcquired) {
      await client.query(`DELETE FROM bi_job_locks WHERE job_name='premium_accrual'`);
    }

    console.error("Accrual failed", err);
  } finally {
    client.release();
  }
}
