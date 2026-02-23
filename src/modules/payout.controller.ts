import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { pool } from "../db";

export async function createPayoutBatch(_: Request, res: Response) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const batch = await client.query<{ id: string }>(
      `INSERT INTO bi_payout_batches DEFAULT VALUES RETURNING id`
    );

    const batchId = batch.rows[0].id;

    const payables = await client.query<{ commission_amount: string }>(
      `UPDATE bi_commission_payables
       SET status='batched', payout_batch_id=$1
       WHERE status='earned'
       RETURNING commission_amount`,
      [batchId]
    );

    const total = payables.rows.reduce(
      (sum, row) => sum + Number(row.commission_amount),
      0
    );

    await client.query(
      `UPDATE bi_payout_batches
       SET total_amount=$1
       WHERE id=$2`,
      [total, batchId]
    );

    await client.query("COMMIT");
    res.json({ batchId, total });
  } catch {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Batch failed" });
  } finally {
    client.release();
  }
}

export async function markBatchPaid(req: Request, res: Response) {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const batchResult = await client.query<{ total_amount: string }>(
      `UPDATE bi_payout_batches
       SET status='paid', paid_at=NOW()
       WHERE id=$1
       RETURNING total_amount`,
      [id]
    );

    if (batchResult.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Batch not found" });
      return;
    }

    await client.query(
      `UPDATE bi_commission_payables
       SET status='paid'
       WHERE payout_batch_id=$1`,
      [id]
    );

    const payoutAmount = Number(batchResult.rows[0].total_amount);
    const txId = randomUUID();

    await client.query(
      `INSERT INTO bi_ledger
       (tx_id, account, debit, credit, description, reference_id)
       VALUES
       ($1,'Commission Payable',$2,0,'Commission paid',$3),
       ($1,'Cash',0,$2,'Commission paid',$3)`,
      [txId, payoutAmount, id]
    );

    await client.query("COMMIT");
    res.json({ paid: true });
  } catch {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Batch payment failed" });
  } finally {
    client.release();
  }
}
