// BI_SERVER_BLOCK_v281_APOLLO_ENROLLMENT_WEBHOOK_v1
// Apollo sequence-event webhook receiver. Mounted at
// /api/v1/bi/apollo/webhook WITHOUT requireAuth — Apollo signs
// with HMAC-SHA256 via APOLLO_WEBHOOK_SECRET. Mirrors the pattern
// pgiWebhookRoutes uses for PGI carrier events.
//
// Event mapping → bi_apollo_enrollment.status:
//   email_replied / replied            → 'replied'
//   email_bounced / bounced            → 'bounced'
//   email_unsubscribed / unsubscribed  → 'paused'
//   sequence_finished / completed      → 'completed'
//   sequence_failed / failed / error   → 'failed'
//   anything else                      → status unchanged
// last_event + last_event_at are written unconditionally.
import crypto from "crypto";
import express from "express";
import { pool } from "../db";
import { env } from "../platform/env";
import { logger } from "../platform/logger";

const router = express.Router();

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const secret = process.env.APOLLO_WEBHOOK_SECRET || "";
  if (!secret) {
    // In production, refuse unsigned webhooks. In dev allow them
    // so the operator can curl test payloads.
    return env.NODE_ENV !== "production";
  }
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  let receivedBuf: Buffer;
  try {
    receivedBuf = Buffer.from(signatureHeader.replace(/^sha256=/, ""), "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

function mapEventToStatus(eventRaw: string): string | null {
  const ev = eventRaw.toLowerCase().trim();
  if (ev.includes("reply") || ev.includes("replied")) return "replied";
  if (ev.includes("bounce") || ev.includes("bounced")) return "bounced";
  if (ev.includes("unsubscribe")) return "paused";
  if (ev.includes("finished") || ev === "completed" || ev.includes("complete")) return "completed";
  if (ev === "failed" || ev.includes("error") || ev === "failure") return "failed";
  return null;
}

router.post(
  "/api/v1/bi/apollo/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature =
      req.header("X-Apollo-Signature") ||
      req.header("X-Hub-Signature-256") ||
      req.header("X-Webhook-Signature");

    if (!verifySignature(rawBody, signature)) {
      logger.warn({ hasSig: !!signature }, "apollo_webhook_invalid_signature");
      return res.status(401).json({ error: "invalid_signature" });
    }

    let evt: any = {};
    try {
      evt = JSON.parse(rawBody.toString("utf8") || "{}");
    } catch {
      return res.status(400).json({ error: "invalid_json" });
    }

    // Tolerate several payload shapes — Apollo's webhook envelope
    // varies by event type. We accept:
    //   { event_type, contact: { id }, sequence: { id } }
    //   { event, apollo_contact_id, sequence_id }
    //   { type, data: { contact_id, sequence_id } }
    const eventRaw = String(evt.event_type ?? evt.event ?? evt.type ?? evt.action ?? "").trim();
    const apolloContactId = String(
      evt.apollo_contact_id ??
        evt.contact?.id ??
        evt.contact_id ??
        evt.data?.contact_id ??
        evt.data?.apollo_contact_id ??
        "",
    ).trim();
    const apolloSequenceId = String(
      evt.sequence?.id ?? evt.sequence_id ?? evt.apollo_sequence_id ?? evt.data?.sequence_id ?? "",
    ).trim();

    if (!eventRaw || !apolloContactId) {
      return res.status(400).json({ error: "missing_event_or_contact" });
    }

    const newStatus = mapEventToStatus(eventRaw);

    // Resolve our enrollment row(s). Apollo's contact id maps to
    // bi_apollo_enrollment.apollo_contact_id. If a sequence id is
    // present, narrow to that sequence; otherwise update all
    // enrollments for the contact (rare — Apollo usually sends
    // per-sequence events).
    const params: unknown[] = [apolloContactId];
    let where = `apollo_contact_id = $1`;
    if (apolloSequenceId) {
      // Resolve our internal sequence_id from apollo_sequence_id.
      const seq = await pool.query<{ id: string }>(
        `SELECT id FROM bi_apollo_sequence WHERE apollo_sequence_id = $1 LIMIT 1`,
        [apolloSequenceId],
      );
      if (seq.rows[0]) {
        params.push(seq.rows[0].id);
        where += ` AND sequence_id = $2`;
      }
    }

    const setSql = newStatus
      ? `status = $${params.length + 1}, last_event = $${params.length + 2}, last_event_at = NOW()`
      : `last_event = $${params.length + 1}, last_event_at = NOW()`;
    if (newStatus) params.push(newStatus, eventRaw);
    else params.push(eventRaw);

    try {
      const upd = await pool.query<{ id: string }>(
        `UPDATE bi_apollo_enrollment SET ${setSql} WHERE ${where} RETURNING id`,
        params,
      );
      if (upd.rowCount === 0) {
        // No matching enrollment — possibly an event for a contact
        // we didn't enroll through our system. Log + 200 so Apollo
        // doesn't retry.
        logger.info({ apolloContactId, apolloSequenceId, eventRaw }, "apollo_webhook_no_match");
        return res.json({ ok: true, matched: 0 });
      }
      return res.json({ ok: true, matched: upd.rowCount, status: newStatus });
    } catch (err: any) {
      logger.error({ err, apolloContactId, eventRaw }, "apollo_webhook_update_failed");
      return res.status(500).json({ error: "update_failed" });
    }
  },
);

export default router;
