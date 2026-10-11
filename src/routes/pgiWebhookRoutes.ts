// BI_SERVER_BLOCK_v225_CARRIER_VISIBILITY_v1
// BI_SERVER_v789_PGI_WEBHOOK_TX - the PGI webhook is processed in ONE
// transaction on ONE client:
//   BEGIN; dedup row into bi_webhook_log; status/quote/policy updates; COMMIT.
// Any failure rolls the whole thing back (the dedup row included) and answers
// 500, so PGI's retry reprocesses the event instead of it being marked "done"
// with half the updates missing. A pgi_webhook_failed event is written after
// the rollback.
//   - Events with no id are deduplicated by sha256 of the raw body.
//   - Status writes are forward-only: a late application.received can never
//     move an approved application back (guard in the UPDATE's WHERE, atomic).
//   - Events whose own timestamp is older than 24 hours are ignored (200, so
//     PGI stops retrying them) and logged.
//   - Side effects that cannot be rolled back (push notifications, the BF
//     referral notify, the approval hook) run only after COMMIT.
import crypto from "crypto";
import express from "express";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { env } from "../platform/env";
import { logger } from "../platform/logger";
import { logHiddenError } from "../platform/safeError";
import { onApplicationApproved } from "../services/pgiOnApprovedHook";
import { recordPgiWebhookFailed } from "../services/biCarrierEvents";

const router = express.Router();

export const PGI_WEBHOOK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Pipeline order of bi_applications.status values. A webhook may only move an
// application to a status of the same or a later rank.
export const PGI_STATUS_RANK: Readonly<Record<string, number>> = {
  new_application: 0,
  created: 0,
  in_progress: 1,
  document_review: 2,
  docs_rejected: 2,
  ready_for_submission: 3,
  submitted: 4,
  sent_to_pgi: 4,
  under_review: 5,
  information_required: 5,
  approved: 6,
  accepted: 6,
  declined: 6,
  policy_issued: 7,
};

// SQL rank of the row's CURRENT status. Built only from the constant map above
// (no user input). Unknown or NULL status ranks -1 so it can always advance.
const CURRENT_STATUS_RANK_SQL = `(CASE status ${Object.entries(PGI_STATUS_RANK)
  .map(([s, n]) => `WHEN '${s}' THEN ${n}`)
  .join(" ")} ELSE -1 END)`;

function rankOf(status: string): number {
  const n = PGI_STATUS_RANK[status];
  if (n === undefined) throw new Error(`unknown target status ${status}`);
  return n;
}

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.PGI_WEBHOOK_SECRET || !signatureHeader) return false;
  const expected = crypto.createHmac("sha256", env.PGI_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  let receivedBuf: Buffer;
  try { receivedBuf = Buffer.from(signatureHeader, "hex"); } catch { return false; }
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/** The event's own timestamp in ms, or null when it carries none we can read. */
export function eventTimestampMs(evt: Record<string, unknown>): number | null {
  const raw = evt.timestamp ?? evt.created_at ?? evt.occurred_at;
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Unix seconds vs milliseconds.
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === "string") {
    if (/^\d+(\.\d+)?$/.test(raw.trim())) {
      const n = Number(raw);
      return n < 1e12 ? n * 1000 : n;
    }
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Dedup key: the event id when PGI sends one, else sha256 of the raw body. */
export function webhookDedupKey(evt: Record<string, unknown>, rawBody: Buffer): string {
  const id = String(evt.id ?? evt.webhook_id ?? evt.event_id ?? "").trim();
  if (id) return id;
  return `sha256:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
}

/** Forward-only status write. Returns the updated application ids (empty when the guard refused). */
async function advanceStatus(
  client: PoolClient,
  pgiApplicationId: unknown,
  status: string,
  extraSet = "",
  extraParams: unknown[] = [],
): Promise<string[]> {
  // $1 = pgi_application_id, $2 = new status, $3 = its rank, $4.. = extraSet params.
  const r = await client.query<{ id: string }>(
    `UPDATE bi_applications
        SET status = $2${extraSet ? `, ${extraSet}` : ""}, updated_at = NOW()
      WHERE pgi_application_id = $1
        AND ${CURRENT_STATUS_RANK_SQL} <= $3
      RETURNING id`,
    [pgiApplicationId, status, rankOf(status), ...extraParams],
  );
  return r.rows.map((row) => row.id);
}

/** A statement that must not abort the webhook: run it under a savepoint, log a failure. */
async function bestEffort(client: PoolClient, label: string, sql: string, params: unknown[]): Promise<{ rows: any[]; rowCount: number | null } | null> {
  await client.query("SAVEPOINT pgi_webhook_best_effort");
  try {
    const r = await client.query(sql, params);
    await client.query("RELEASE SAVEPOINT pgi_webhook_best_effort");
    return r;
  } catch (err) {
    logger.warn({ err }, `pgi_webhook_best_effort_failed:${label}`);
    await client.query("ROLLBACK TO SAVEPOINT pgi_webhook_best_effort");
    return null;
  }
}

type AfterCommit = { label: string; run: () => Promise<unknown> };

function pushAfterCommit(after: AfterCommit[], pgiApplicationId: unknown, notice: { kind: "APPLICATION_UPDATE" | "DOCUMENT_REQUEST"; title: string; body: string }) {
  after.push({
    label: `push:${notice.kind}`,
    run: async () => {
      const m = await import("../services/push/biPushSender");
      await m.notifyBiApplicant({ pgiApplicationId: String(pgiApplicationId ?? ""), ...notice });
    },
  });
}

router.post("/api/v1/webhooks/pgi", express.raw({ type: "application/json" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const signature = req.header("X-PGI-Signature");
  if (!verifySignature(rawBody, signature)) return res.status(401).json({ error: "invalid_signature" });

  let evt: Record<string, any>;
  try {
    const parsed = JSON.parse(rawBody.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    evt = parsed;
  } catch (err) {
    logger.warn({ err }, "pgi_webhook_bad_json");
    return res.status(400).json({ error: "bad_json" });
  }
  const eventName = String(evt.event ?? "unknown");
  const pgiApplicationId = evt.application_id;

  // Stale events (older than 24h by their own timestamp) are acknowledged and
  // dropped; 200 so PGI does not retry them forever.
  const ts = eventTimestampMs(evt);
  if (ts !== null && Date.now() - ts > PGI_WEBHOOK_MAX_AGE_MS) {
    logger.warn({ event: eventName, pgiApplicationId, eventTimestamp: new Date(ts).toISOString() }, "pgi_webhook_stale_ignored");
    return res.json({ ok: true, ignored: "stale" });
  }

  // BI_SERVER_BLOCK_v182_PGI_WEBHOOK_IDEMPOTENCY_v1 - dedup on
  // bi_webhook_log.pgi_webhook_id (UNIQUE).
  const webhookId = webhookDedupKey(evt, rawBody);
  const after: AfterCommit[] = [];
  let appId: string | null = null;

  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    const requestId = logHiddenError(req, err, "pgi_webhook_failed");
    await recordPgiWebhookFailed(null, err, { stage: "connect", event: eventName, pgi_application_id: pgiApplicationId ?? null, webhook_id: webhookId });
    return res.status(500).json({ error: "pgi_webhook_failed", requestId });
  }

  try {
    await client.query("BEGIN");
    const dedup = await client.query(
      `INSERT INTO bi_webhook_log (pgi_webhook_id, event_type, payload, processed_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (pgi_webhook_id) DO NOTHING
       RETURNING id`,
      [webhookId, eventName, JSON.stringify(evt)],
    );
    if ((dedup.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      logger.info({ webhookId, event: eventName }, "pgi_webhook_duplicate_skipped");
      return res.json({ ok: true, deduped: true });
    }

    if (eventName === "application.received") {
      const ids = await advanceStatus(client, pgiApplicationId, "submitted", "carrier_received_at = COALESCE(carrier_received_at, NOW())");
      appId = ids[0] ?? appId;
    } else if (eventName === "application.quoted") {
      /* BI_SERVER_BLOCK_v62_STAGE_ALIGNMENT_v1 - quoted folds into under_review per
         Todd's locked pipeline spec. Quote data persists; only policy.bound
         triggers the actual approval. The quote data is kept even when the
         status may not move (a late quote after approval). */
      const q = await client.query<{ id: string }>(
        `UPDATE bi_applications SET quote_id=$1, underwriter_ref=$2, annual_premium=$3, quote_valid_until=$4, updated_at=NOW()
          WHERE pgi_application_id=$5 RETURNING id`,
        [evt.quote_id, evt.underwriter_ref, evt.annual_premium, evt.valid_until, pgiApplicationId],
      );
      appId = q.rows[0]?.id ?? appId;
      await advanceStatus(client, pgiApplicationId, "under_review");
    } else if (eventName === "application.declined") {
      const ids = await advanceStatus(client, pgiApplicationId, "declined", "score_reason = $4", [evt.reason ?? "PGI declined"]);
      appId = ids[0] ?? appId;
      // BI_SERVER_PUSH_DISPATCH_v240
      if (ids.length) pushAfterCommit(after, pgiApplicationId, { kind: "APPLICATION_UPDATE", title: "Application update", body: "There is an update on your application. Open Boreal Risk for details." });
    } else if (eventName === "application.information_required") {
      const ids = await advanceStatus(client, pgiApplicationId, "information_required");
      appId = ids[0] ?? appId;
      if (ids.length) pushAfterCommit(after, pgiApplicationId, { kind: "DOCUMENT_REQUEST", title: "More information needed", body: "The carrier needs more information to continue your application." });
    } else if (eventName === "application.approved") {
      // BI_SERVER_BLOCK_v173_PGI_WEBHOOK_BOUND_HANDLER_v1 - approved, not yet
      // bound; the approval hook fires on the binding event below.
      const ids = await advanceStatus(client, pgiApplicationId, "approved");
      appId = ids[0] ?? appId;
      if (ids.length) pushAfterCommit(after, pgiApplicationId, { kind: "APPLICATION_UPDATE", title: "Your application was approved", body: "Open Boreal Risk to see the next steps." });
    } else if (eventName === "policy.bound" || eventName === "policy.issued") {
      // BI_SERVER_BLOCK_v173_PGI_WEBHOOK_BOUND_HANDLER_v1 - the actual approval
      // signal: policy_issued, bi_policies row, purge queue, commission, then
      // (after COMMIT) the approval hook and the BF referral notify.
      const ids = await advanceStatus(
        client, pgiApplicationId, "policy_issued",
        "policy_id = $4, policy_bound_at = NOW()", [evt.policy_id ?? null],
      );
      const boundId = ids[0];
      if (boundId) {
        appId = boundId;
        await bestEffort(client, "bi_policies", `INSERT INTO bi_policies(application_id, status, policy_id)
           VALUES($1, 'active', $2) ON CONFLICT DO NOTHING`, [boundId, evt.policy_id ?? null]);
        await bestEffort(client, "bi_purge_queue", `INSERT INTO bi_purge_queue(application_id, eligible_at)
           VALUES($1, NOW()) ON CONFLICT (application_id) DO NOTHING`, [boundId]);
        await bestEffort(client, "bi_activity_policy_bound", `INSERT INTO bi_activity(application_id, actor_type, event_type, summary)
           VALUES($1, 'system', 'policy_bound', $2)`, [boundId, `Policy bound by carrier (${evt.policy_id ?? "no policy id"})`]);
        // BI_SERVER_BLOCK_v381_COMMISSION_RATE_5PCT_v1 - commission rate 5%.
        await bestEffort(client, "bi_commissions", `INSERT INTO bi_commissions (application_id, annual_premium_amount, commission_rate, commission_amount, status)
           SELECT id, annual_premium, 0.05, ROUND(COALESCE(annual_premium, 0) * 0.05, 2), 'estimated'
             FROM bi_applications WHERE id = $1
           ON CONFLICT (application_id) DO UPDATE
              SET annual_premium_amount = EXCLUDED.annual_premium_amount,
                  commission_rate = EXCLUDED.commission_rate,
                  commission_amount = EXCLUDED.commission_amount,
                  updated_at = NOW()
            WHERE bi_commissions.annual_premium_amount IS DISTINCT FROM EXCLUDED.annual_premium_amount
               OR bi_commissions.commission_rate IS DISTINCT FROM EXCLUDED.commission_rate`, [boundId]);

        // BI_SERVER_REFERRAL_FROM_BF_v1 - tell BF-Server the policy bound so it
        // credits the BF referrer (annual_premium based). After COMMIT.
        after.push({
          label: "notifyBfReferralConversion",
          run: async () => {
            const ref = await pool.query<{ referrer_code: string | null; annual_premium: string | null }>(
              `SELECT referrer_code, annual_premium FROM bi_applications WHERE id = $1 LIMIT 1`,
              [boundId],
            );
            const rc = ref.rows[0];
            if (rc?.referrer_code) {
              const { notifyBfReferralConversion } = await import("../services/notifyBfReferralConversion");
              await notifyBfReferralConversion({
                refCode: rc.referrer_code,
                externalId: boundId,
                premium: rc.annual_premium != null ? Number(rc.annual_premium) : null,
              });
            }
          },
        });
        after.push({ label: "onApplicationApproved", run: () => onApplicationApproved(boundId) });
      }
    }

    // BI_SERVER_BLOCK_v225_CARRIER_VISIBILITY_v1 - generic post-processor.
    const last = await bestEffort(client, "carrier_last_event", `UPDATE bi_applications
          SET carrier_last_event=$1, carrier_last_event_at=NOW(), updated_at=NOW()
        WHERE pgi_application_id=$2
        RETURNING id`, [eventName, pgiApplicationId]);
    const appRowId: string | null = last?.rows?.[0]?.id ?? null;
    if (appRowId) {
      appId = appId ?? appRowId;
      await bestEffort(client, "bi_activity_carrier_event", `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
         VALUES($1, 'system', $2, $3, $4::jsonb)`, [appRowId, `pgi.${eventName}`, `Carrier event: ${eventName}`, JSON.stringify(evt)]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch((rbErr: unknown) => { logger.error({ err: rbErr }, "pgi_webhook_rollback_failed"); });
    const requestId = logHiddenError(req, err, "pgi_webhook_failed");
    await recordPgiWebhookFailed(appId, err, { event: eventName, pgi_application_id: pgiApplicationId ?? null, webhook_id: webhookId });
    return res.status(500).json({ error: "pgi_webhook_failed", requestId });
  } finally {
    client.release();
  }

  for (const step of after) {
    try {
      await step.run();
    } catch (err) {
      logger.warn({ err, step: step.label, appId }, "pgi_webhook_after_commit_failed");
    }
  }
  return res.json({ ok: true });
});

export default router;
