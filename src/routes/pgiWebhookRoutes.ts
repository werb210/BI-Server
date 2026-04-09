import crypto from "crypto";
import express from "express";
import { pool } from "../db";
import { env } from "../platform/env";
import { logger } from "../platform/logger";
import { ok } from "../utils/apiResponse";

type PgiWebhookEvent = {
  id?: string;
  type?: string;
  data?: {
    application_id?: string;
    pgi_webhook_id?: string;
    pgi_support_ticket_id?: string;
    [key: string]: unknown;
  };
};

const router = express.Router();

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) {
    return false;
  }

  const digest = crypto
    .createHmac("sha256", env.PGI_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const expected = Buffer.from(digest, "utf8");
  const provided = Buffer.from(signatureHeader, "utf8");

  if (expected.length !== provided.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, provided);
}

async function writeActivity(applicationId: string | null, eventType: string, summary: string, meta: object = {}) {
  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
     VALUES($1, 'pgi', $2, $3, $4::jsonb)`,
    [applicationId, eventType, summary, JSON.stringify(meta)]
  );
}

router.post("/webhooks/pgi", express.raw({ type: "application/json" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const signature = req.header("X-PGI-Signature");

  if (!verifySignature(rawBody, signature)) {
    logger.warn("Rejected PGI webhook due to invalid signature");
    return ok(res, { received: true });
  }

  let event: PgiWebhookEvent;

  try {
    event = JSON.parse(rawBody.toString("utf8")) as PgiWebhookEvent;
  } catch (err) {
    logger.error({ err }, "Invalid PGI webhook payload");
    return ok(res, { received: true });
  }

  const webhookId = event.data?.pgi_webhook_id ?? event.id;
  if (!webhookId) {
    logger.warn({ eventType: event.type }, "PGI webhook missing id");
    return ok(res, { received: true });
  }

  try {
    const existing = await pool.query(
      `SELECT id FROM bi_webhook_log WHERE pgi_webhook_id = $1 LIMIT 1`,
      [webhookId]
    );

    if (existing.rows.length > 0) {
      return ok(res, { received: true, duplicate: true });
    }

    const applicationId = (event.data?.application_id as string | undefined) ?? null;

    switch (event.type) {
      case "application.quoted":
        if (applicationId) {
          await pool.query(`UPDATE bi_applications SET stage='quoted' WHERE id=$1`, [applicationId]);
        }
        await writeActivity(applicationId, "application.quoted", "Application quoted", event.data ?? {});
        break;
      case "application.declined":
        if (applicationId) {
          await pool.query(`UPDATE bi_applications SET stage='declined' WHERE id=$1`, [applicationId]);
        }
        await writeActivity(applicationId, "application.declined", "Application declined", event.data ?? {});
        break;
      case "policy.bound":
        if (applicationId) {
          await pool.query(`UPDATE bi_applications SET stage='bound' WHERE id=$1`, [applicationId]);
        }
        await writeActivity(applicationId, "policy.bound", "Policy bound", event.data ?? {});
        break;
      case "claim.submitted":
        if (applicationId) {
          await pool.query(`UPDATE bi_applications SET stage='claim' WHERE id=$1`, [applicationId]);
        }
        await writeActivity(applicationId, "claim.submitted", "Claim submitted", event.data ?? {});
        break;
      case "claim.status_changed":
      case "claim.closed":
      case "support.ticket_closed":
        await writeActivity(applicationId, event.type, `PGI event: ${event.type}`, event.data ?? {});
        break;
      case "support.message_received": {
        const supportTicketId = event.data?.pgi_support_ticket_id as string | undefined;
        let resolvedApplicationId = applicationId;
        if (!resolvedApplicationId && supportTicketId) {
          const result = await pool.query(
            `SELECT id FROM bi_applications WHERE data->>'pgi_support_ticket_id' = $1 LIMIT 1`,
            [supportTicketId]
          );
          resolvedApplicationId = result.rows[0]?.id ?? null;
        }

        await writeActivity(
          resolvedApplicationId,
          "support.message_received",
          "PGI support message received",
          event.data ?? {}
        );
        break;
      }
      default:
        await writeActivity(applicationId, event.type ?? "unknown", "Unhandled PGI webhook event", event.data ?? {});
    }

    await pool.query(
      `INSERT INTO bi_webhook_log (pgi_webhook_id, event_type, payload, processed_at)
       VALUES ($1, $2, $3::jsonb, NOW())`,
      [webhookId, event.type ?? "unknown", JSON.stringify(event)]
    );
  } catch (err) {
    logger.error({ err, webhookId, eventType: event.type }, "Failed processing PGI webhook");
  }

  return ok(res, { received: true });
});

export default router;
