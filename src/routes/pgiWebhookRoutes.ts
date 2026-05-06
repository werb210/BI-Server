import crypto from "crypto";
import express from "express";
import { pool } from "../db";
import { env } from "../platform/env";
import { onApplicationApproved } from "../services/pgiOnApprovedHook";

const router = express.Router();
function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.PGI_WEBHOOK_SECRET || !signatureHeader) return false;
  const expected = crypto.createHmac("sha256", env.PGI_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  let receivedBuf: Buffer;
  try { receivedBuf = Buffer.from(signatureHeader, "hex"); } catch { return false; }
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

router.post("/api/v1/webhooks/pgi", express.raw({ type: "application/json" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const signature = req.header("X-PGI-Signature");
  if (!verifySignature(rawBody, signature)) return res.status(401).json({ error: "invalid_signature" });
  const evt = JSON.parse(rawBody.toString("utf8"));
  if (evt.event === "application.quoted") {
    const prev = await pool.query(`SELECT id, status FROM bi_applications WHERE pgi_application_id=$1 LIMIT 1`, [evt.application_id]);
    /* BI_SERVER_BLOCK_v62_STAGE_ALIGNMENT_v1 — quoted folds into under_review per
       Todd's locked pipeline spec. Quote data persists; only policy.bound
       triggers the actual approval. */
    await pool.query(`UPDATE bi_applications SET status='under_review', quote_id=$1, underwriter_ref=$2, annual_premium=$3, quote_valid_until=$4, updated_at=NOW() WHERE pgi_application_id=$5`, [evt.quote_id, evt.underwriter_ref, evt.annual_premium, evt.valid_until, evt.application_id]);
    // BI_SERVER_BLOCK_v62_STAGE_ALIGNMENT_v1 — onApplicationApproved no
    // longer fires on .quoted (quote != approval per locked spec). It now
    // fires only on policy.bound which is the actual approval signal.
    void prev;
  } else if (evt.event === "application.declined") {
    await pool.query(`UPDATE bi_applications SET status='declined', score_reason=$1, updated_at=NOW() WHERE pgi_application_id=$2`, [evt.reason ?? "PGI declined", evt.application_id]);
  } else if (evt.event === "application.information_required") {
    await pool.query(`UPDATE bi_applications SET status='information_required', updated_at=NOW() WHERE pgi_application_id=$1`, [evt.application_id]);
  } else if (evt.event === "application.approved") {
    // BI_SERVER_BLOCK_v173_PGI_WEBHOOK_BOUND_HANDLER_v1
    // Carrier approved the application but the policy is not yet bound.
    // Stage advances to 'approved'; downstream onApplicationApproved hook
    // does NOT fire here — that is the binding event below.
    await pool.query(
      `UPDATE bi_applications SET status='approved', updated_at=NOW() WHERE pgi_application_id=$1`,
      [evt.application_id]
    );
  } else if (evt.event === "policy.bound" || evt.event === "policy.issued") {
    // BI_SERVER_BLOCK_v173_PGI_WEBHOOK_BOUND_HANDLER_v1
    // Carrier bound the policy — actual approval signal per v62 spec.
    // Advance to policy_issued, create bi_policies row, fire approval
    // hook for referrals/CRM, and enqueue purge.
    const appResult = await pool.query<{ id: string }>(
      `UPDATE bi_applications
          SET status='policy_issued',
              policy_id=$1,
              policy_bound_at=NOW(),
              updated_at=NOW()
        WHERE pgi_application_id=$2
        RETURNING id`,
      [evt.policy_id ?? null, evt.application_id]
    );
    const appId = appResult.rows[0]?.id;
    if (appId) {
      await pool.query(
        `INSERT INTO bi_policies(application_id, status, policy_id)
         VALUES($1, 'active', $2) ON CONFLICT DO NOTHING`,
        [appId, evt.policy_id ?? null]
      ).catch(() => {});
      await pool.query(
        `INSERT INTO bi_purge_queue(application_id, eligible_at)
         VALUES($1, NOW()) ON CONFLICT (application_id) DO NOTHING`,
        [appId]
      ).catch(() => {});
      await pool.query(
        `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
         VALUES($1, 'system', 'policy_bound', $2)`,
        [appId, `Policy bound by carrier (${evt.policy_id ?? "no policy id"})`]
      ).catch(() => {});
      await onApplicationApproved(appId).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[v173] onApplicationApproved failed", err);
      });
    }
  }
  res.json({ ok: true });
});

export default router;
