import { Client } from "pg";
import { runMigrations } from "../db/runMigrations";

const url = process.env.DATABASE_URL_TEST;
if (!url) {
  console.log("DATABASE_URL_TEST not set — skipping migrations smoke test");
  process.exit(0);
}

const REQUIRED_TABLES = [
  "bi_applications", "bi_documents", "bi_companies", "bi_contacts",
  "bi_lenders", "bi_referrers", "bi_referrals", "bi_policies",
  "bi_commissions", "bi_activity", "bi_otp_sessions",
  "maya_leads", "bi_leads", "pgi_applications", "admin_users",
];

const REQUIRED_BI_APP_COLUMNS = [
  "created_by_actor", "applicant_phone_e164", "packaging_status",
  "data", "premium_calc", "updated_at", "annual_premium",
  "coverage_amount", "pgi_external_id", "core_score",
];

async function main() {
  await runMigrations(url!);

  const client = new Client({ connectionString: url });
  await client.connect();
  const failures: string[] = [];

  for (const t of REQUIRED_TABLES) {
    const r = await client.query(
      `SELECT to_regclass($1) AS reg`,
      [`public.${t}`]
    );
    if (!r.rows[0].reg) failures.push(`missing table: ${t}`);
  }

  for (const c of REQUIRED_BI_APP_COLUMNS) {
    const r = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name='bi_applications' AND column_name=$1`,
      [c]
    );
    if (r.rowCount === 0) failures.push(`missing column bi_applications.${c}`);
  }

  await client.end();

  if (failures.length) {
    console.error("MIGRATION SMOKE FAILED:");
    for (const f of failures) console.error("  -", f);
    process.exit(1);
  }
  console.log(`OK — ${REQUIRED_TABLES.length} tables and ${REQUIRED_BI_APP_COLUMNS.length} columns present.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
