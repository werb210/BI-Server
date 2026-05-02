// BI_BLOCK_PGI_ALIGNMENT_v1
import { pool } from "../db";

export async function onApplicationApproved(applicationId: string) {
  await pool.query(`UPDATE bi_referrals SET status='approved', updated_at=NOW() WHERE application_id=$1`, [applicationId]);
  await pool.query(`UPDATE bi_contacts c SET tags = ARRAY(SELECT DISTINCT unnest(c.tags || ARRAY['applicant'])) FROM bi_referrals r WHERE r.application_id=$1 AND c.email = r.email`, [applicationId]);
}
