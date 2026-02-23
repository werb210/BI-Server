import { pool } from "../db";

export async function runCommissionAccrual() {
  const due = await pool.query(
    `SELECT * FROM bi_premium_schedule
     WHERE due_date <= NOW() AND paid=false`
  );

  for (const row of due.rows) {
    await pool.query(`UPDATE bi_premium_schedule SET paid=true WHERE id=$1`, [row.id]);

    await pool.query(
      `INSERT INTO bi_ledger(entity_type, entity_id, transaction_type, amount)
       VALUES ($1,$2,$3,$4)`,
      ["premium", row.id, "premium_paid", row.premium_amount]
    );
  }
}
