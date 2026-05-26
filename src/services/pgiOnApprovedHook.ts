// BI_BLOCK_PGI_ALIGNMENT_v1
// BI_SERVER_BLOCK_v366_NOTIFICATION_SMS_v2 — added applicant + referrer SMS.
import { pool } from "../db";

export async function onApplicationApproved(applicationId: string) {
  // Existing DB updates (preserved from BI_BLOCK_PGI_ALIGNMENT_v1).
  await pool.query(
    `UPDATE bi_referrals SET status='approved', updated_at=NOW() WHERE application_id=$1`,
    [applicationId]
  );
  await pool.query(
    `UPDATE bi_contacts c SET tags = ARRAY(SELECT DISTINCT unnest(c.tags || ARRAY['applicant'])) FROM bi_referrals r WHERE r.application_id=$1 AND c.email = r.email`,
    [applicationId]
  );

  // BI_SERVER_BLOCK_v366_NOTIFICATION_SMS_v2
  // Notify the applicant + (when attributed) the referrer.
  // All SMS calls wrapped in try/catch — DB updates above MUST complete
  // even if Twilio is down.
  try {
    const { sendOutreachSms } = await import("./smsService");
    const appRow = await pool.query<{
      public_id: string;
      applicant_phone_e164: string | null;
      business_name: string | null;
      referrer_id: string | null;
    }>(
      `SELECT public_id, applicant_phone_e164, business_name, referrer_id
         FROM bi_applications WHERE id = $1 LIMIT 1`,
      [applicationId]
    );
    const app = appRow.rows[0];
    if (!app) return;

    const baseUrl = process.env.BI_PUBLIC_URL || "https://www.boreal.insure";

    // 1. Applicant — congratulatory + policy link.
    if (app.applicant_phone_e164) {
      const policyUrl = `${baseUrl}/applications/${app.public_id}`;
      const applicantBody = `Boreal Risk: Your PGI application has been APPROVED and bound. Policy details: ${policyUrl}`;
      await sendOutreachSms(app.applicant_phone_e164, applicantBody).catch((e) =>
        console.warn("[v366] applicant bound SMS failed", { error: (e as Error)?.message })
      );
    }

    // 2. Referrer — heads-up that one of their referrals closed.
    if (app.referrer_id) {
      const referrer = (await pool.query<{ phone_e164: string | null; display_name: string | null }>(
        `SELECT phone_e164, display_name FROM bi_referrers WHERE id = $1 LIMIT 1`,
        [app.referrer_id]
      )).rows[0];
      if (referrer?.phone_e164) {
        const businessName = app.business_name || "your referral";
        const referrerBody = `Boreal Risk: Great news — ${businessName} bound a PGI policy. Commission details will follow.`;
        await sendOutreachSms(referrer.phone_e164, referrerBody).catch((e) =>
          console.warn("[v366] referrer bound SMS failed", { error: (e as Error)?.message })
        );
      }
    }
  } catch (err) {
    console.warn("[v366] policy.bound notification block failed (non-fatal)", { applicationId, error: (err as Error)?.message });
  }
}
