import { randomUUID } from "crypto";
import { pool } from "../db";

export async function runCommissionAccrual() {
  const due = await pool.query(
    `SELECT * FROM bi_premium_schedule
     WHERE due_date <= NOW() AND paid=false`
  );

  for (const row of due.rows) {
    await pool.query(`UPDATE bi_premium_schedule SET paid=true WHERE id=$1`, [row.id]);

    const txId = randomUUID();

    await pool.query(
      `INSERT INTO bi_ledger
       (tx_id, account, debit, credit, description, reference_id)
       VALUES
       ($1,'Premium Receivable',$2,0,'Premium earned',$3),
       ($1,'Premium Revenue',0,$2,'Premium earned',$3)`,
      [txId, row.premium_amount, row.id]
    );
  }
}
