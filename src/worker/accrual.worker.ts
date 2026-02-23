import { randomUUID } from "crypto";
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

    const due = await client.query<{
      id: string;
      policy_id: string;
      premium_amount: string;
      referrer_id: string | null;
      commission_rate: string;
    }>(
      `SELECT s.id,
              s.policy_id,
              s.premium_amount,
              l.referrer_id,
              COALESCE(r.commission_rate, 0) AS commission_rate
       FROM bi_premium_schedule s
       LEFT JOIN bi_policies p ON p.id = s.policy_id
       LEFT JOIN bi_applications a ON a.id = p.application_id
       LEFT JOIN bi_leads l ON l.id = a.lead_id
       LEFT JOIN bi_referrers r ON r.id = l.referrer_id
       WHERE s.due_date <= NOW() AND s.paid = false`
    );

    for (const row of due.rows) {
      await client.query(
        `UPDATE bi_premium_schedule
         SET paid = true
         WHERE id = $1`,
        [row.id]
      );

      const grossPremium = Number(row.premium_amount);
      const premiumTxId = randomUUID();

      await client.query(
        `INSERT INTO bi_ledger
         (tx_id, account, debit, credit, description, reference_id)
         VALUES
         ($1,'Premium Receivable',$2,0,'Premium earned',$3),
         ($1,'Premium Revenue',0,$2,'Premium earned',$3)`,
        [premiumTxId, grossPremium, row.id]
      );

      const commissionRate = Number(row.commission_rate);

      const commissionAmount = grossPremium * commissionRate;

      await client.query(
        `INSERT INTO bi_commission_payables
         (policy_id, premium_schedule_id, referrer_id,
          gross_premium, commission_rate, commission_amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          row.policy_id,
          row.id,
          row.referrer_id,
          grossPremium,
          commissionRate,
          commissionAmount
        ]
      );

      if (commissionAmount > 0) {
        const commissionTxId = randomUUID();

        await client.query(
          `INSERT INTO bi_ledger
           (tx_id, account, debit, credit, description, reference_id)
           VALUES
           ($1,'Commission Expense',$2,0,'Commission earned',$3),
           ($1,'Commission Payable',0,$2,'Commission earned',$3)`,
          [commissionTxId, commissionAmount, row.id]
        );
      }
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
