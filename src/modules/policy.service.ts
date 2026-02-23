import { pool } from "../db";
import { randomUUID } from "crypto";

export async function activatePolicy(
  applicationId: string,
  premium: number,
  idempotencyKey?: string
) {
  const app = await pool.query(
    `SELECT status FROM bi_applications WHERE id=$1`,
    [applicationId]
  );

  if (app.rows[0]?.status !== "approved") {
    throw new Error("Application not approved");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (idempotencyKey) {
      try {
        await client.query(`INSERT INTO bi_idempotency(id) VALUES($1)`, [
          idempotencyKey
        ]);
      } catch (error: any) {
        if (error?.code === "23505") {
          const existingPolicy = await client.query(
            `SELECT *
             FROM bi_policies
             WHERE application_id=$1
             ORDER BY created_at DESC
             LIMIT 1`,
            [applicationId]
          );

          if (existingPolicy.rows[0]) {
            await client.query("ROLLBACK");
            return existingPolicy.rows[0];
          }
        }

        throw error;
      }
    }

    const policyNumber = `BI-${randomUUID().slice(0, 8).toUpperCase()}`;

    const policy = await client.query(
      `INSERT INTO bi_policies
       (application_id, policy_number, premium_amount, start_date)
       VALUES ($1,$2,$3,NOW())
       RETURNING *`,
      [applicationId, policyNumber, premium]
    );

    await client.query(
      `INSERT INTO bi_ledger(entity_type, entity_id, transaction_type, amount)
       VALUES ($1,$2,$3,$4)`,
      ["policy", policy.rows[0].id, "policy_created", premium]
    );

    await client.query("COMMIT");
    return policy.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
