import { pool } from "../db";

export async function generateRecurringCommission(
  applicationId: string,
  premium: number,
  rate: number
) {
  const commission = premium * rate;

  // BI_SERVER_LIVE_SCHEMA_COLUMNS_v5
  // bi_commissions on bi-pg01 has no commission_type and no premium_amount.
  // The premium column is annual_premium_amount, and there is no type column at
  // all - every recurring commission this generated threw undefined_column.
  await pool.query(
    `INSERT INTO bi_commissions
     (application_id, commission_rate, annual_premium_amount, commission_amount, status)
     VALUES ($1,$2,$3,$4,$5)`,
    [applicationId, rate, premium, commission, "expected"]
  );
}
