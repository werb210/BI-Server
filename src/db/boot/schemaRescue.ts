import { pool } from "../../db";
import { logger } from "../../platform/logger";

type Step = { name: string; sql: string };
const STEPS: Step[] = [
  { name: "bi_crm_engagement_events.occurred_at", sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bi_crm_engagement_events' AND column_name='occurred_at') THEN ALTER TABLE bi_crm_engagement_events ADD COLUMN occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(); END IF; END $$;` },
  { name: "bi_sequence_enrollments.next_send_at", sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bi_sequence_enrollments' AND column_name='next_send_at') THEN ALTER TABLE bi_sequence_enrollments ADD COLUMN next_send_at TIMESTAMPTZ; END IF; END $$;` },
  { name: "bi_user_send_quotas.quota_date", sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bi_user_send_quotas' AND column_name='quota_date') THEN ALTER TABLE bi_user_send_quotas ADD COLUMN quota_date DATE NOT NULL DEFAULT CURRENT_DATE; END IF; END $$;` },
  { name: "bi_contacts_email_unique_lower", sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_bi_contacts_email_lower ON bi_contacts (LOWER(TRIM(email))) WHERE email IS NOT NULL AND TRIM(email) <> '';` },
  { name: "bi_activity.contact_id", sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bi_activity' AND column_name='contact_id') THEN ALTER TABLE bi_activity ADD COLUMN contact_id UUID; END IF; END $$;` },
  { name: "bi_applications.company_id", sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bi_applications' AND column_name='company_id') THEN ALTER TABLE bi_applications ADD COLUMN company_id UUID; END IF; END $$;` },
];
export async function runSchemaRescue(): Promise<void> {
  let ok = 0, failed = 0;
  for (const s of STEPS) {
    try { await pool.query(s.sql); ok++; } catch (err) { failed++; logger.error({ err: String((err as Error)?.message ?? err), step: s.name }, "[v320 schemaRescue] step failed (continuing)"); }
  }
  logger.info({ ok, failed, total: STEPS.length }, "[v320 schemaRescue] complete");
}
