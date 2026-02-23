import { pool } from "../db";

export async function activatePolicy(applicationId: string, premium: number) {
  const policyNumber = `BI-${Date.now()}`;

  const policy = await pool.query(
    `INSERT INTO bi_policies
     (application_id, policy_number, premium_amount, start_date)
     VALUES ($1,$2,$3,NOW())
     RETURNING *`,
    [applicationId, policyNumber, premium]
  );

  await pool.query(
    `INSERT INTO bi_ledger(entity_type, entity_id, transaction_type, amount)
     VALUES ($1,$2,$3,$4)`,
    ["policy", policy.rows[0].id, "policy_created", premium]
  );

  return policy.rows[0];
}
