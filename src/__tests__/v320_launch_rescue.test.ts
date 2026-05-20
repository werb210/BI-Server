import { runSchemaRescue } from "../db/boot/schemaRescue";
import { pool } from "../db";

describe("BI_SERVER_BLOCK_v320_LAUNCH_RESCUE_v1", () => {
  it("creates the three missing columns idempotently", async () => {
    await runSchemaRescue();
    const r = await pool.query(`
      SELECT table_name, column_name FROM information_schema.columns
       WHERE (table_name='bi_crm_engagement_events' AND column_name='occurred_at')
          OR (table_name='bi_sequence_enrollments'   AND column_name='next_send_at')
          OR (table_name='bi_user_send_quotas'       AND column_name='quota_date')
    `);
    expect(r.rows.length).toBe(3);
  });
  it("creates the bi_contacts email unique index", async () => {
    await runSchemaRescue();
    const r = await pool.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'uq_bi_contacts_email_lower'`);
    expect(r.rowCount).toBe(1);
  });
  it("is safe to run twice in a row", async () => {
    await runSchemaRescue();
    await expect(runSchemaRescue()).resolves.toBeUndefined();
  });
});
