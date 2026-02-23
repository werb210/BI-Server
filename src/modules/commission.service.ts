import { pool } from "../db";

export async function generateRecurringCommission(
  applicationId: string,
  premium: number,
  rate: number
) {
  const commission = premium * rate;

  await pool.query(
    `INSERT INTO bi_commissions
     (application_id, commission_type, commission_rate, premium_amount, commission_amount, status)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [applicationId, "recurring", rate, premium, commission, "expected"]
  );
}
