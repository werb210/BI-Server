import crypto from "crypto";
import express from "express";
import { pool } from "../db";
import { env } from "../platform/env";
import { logger } from "../platform/logger";
import { ok } from "../utils/apiResponse";

type PgiWebhookEvent = {
  webhook_id?: string;
  id?: string;
  event?: string;
  type?: string;
  application_id?: string;
  data?: {
    application_id?: string;
    [key: string]: unknown;
  };
};

const router = express.Router();

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.PGI_WEBHOOK_SECRET || !signatureHeader) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", env.PGI_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");

  let receivedBuf: Buffer;
  try {
    receivedBuf = Buffer.from(signatureHeader, "hex");
  } catch {
    return false;
  }

  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

async function writeActivity(
  applicationId: string | null,
  eventType: string,
  summary: string,
  meta: object = {}
) {
  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
     VALUES($1, 'system', $2, $3, $4::jsonb)`,
    [applicationId, eventType, summary, JSON.stringify(meta)]
  );
}

router.post(
  "/api/v1/bi/webhooks/pgi",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = req.header("X-PGI-Signature");

    if (!verifySignature(rawBody, signature)) {
      logger.warn("Rejected PGI webhook due to invalid signature");
      return res.status(401).json({ error: "invalid_signature" });
    }

    let event: PgiWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString("utf8")) as PgiWebhookEvent;
    } catch (err) {
      logger.error({ err }, "Invalid PGI webhook payload");
      return res.status(400).json({ error: "invalid_json" });
    }

    const eventType = event.event ?? event.type ?? "unknown";
    const webhookId =
      event.webhook_id ??
      event.id ??
      crypto.createHash("sha256").update(rawBody).digest("hex");

    const applicationExternalId =
      (event.application_id as string | undefined) ??
      (event.data?.application_id as string | undefined) ??
      null;

    try {
      const insertLog = await pool.query(
        `INSERT INTO bi_webhook_log (pgi_webhook_id, event_type, payload, processed_at)
         VALUES ($1, $2, $3::jsonb, NOW())
         ON CONFLICT (pgi_webhook_id) DO NOTHING
         RETURNING id`,
        [webhookId, eventType, JSON.stringify(event)]
      );

      if (insertLog.rows.length === 0) {
        return ok(res, { received: true, duplicate: true });
      }

      let appRowId: string | null = null;
      if (applicationExternalId) {
        const appLookup = await pool.query(
          `SELECT id FROM bi_applications WHERE pgi_external_id=$1 LIMIT 1`,
          [applicationExternalId]
        );
        appRowId = appLookup.rows[0]?.id ?? null;
      }

      const data = event.data ?? {};

      switch (eventType) {
        case "application.quoted":
          if (appRowId) {
            await pool.query(
              `UPDATE bi_applications
                 SET stage='quoted',
                     quote_summary=$2::jsonb,
                     quote_expiry_at=COALESCE(($3)::timestamp, quote_expiry_at),
                     underwriter_ref=COALESCE($4, underwriter_ref),
                     coverage_amount=COALESCE(($5)::numeric, coverage_amount),
                     annual_premium=COALESCE(($6)::numeric, annual_premium),
                     core_score=COALESCE(($7)::numeric, core_score),
                     updated_at=NOW()
               WHERE id=$1`,
              [
                appRowId,
                JSON.stringify(data),
                (data.quote_expiry_at as string | undefined) ?? null,
                (data.underwriter_ref as string | undefined) ?? null,
                (data.coverage_amount as string | number | undefined) ?? null,
                (data.annual_premium as string | number | undefined) ?? null,
                (data.core_score as string | number | undefined) ?? null
              ]
            );
          }
          await writeActivity(appRowId, eventType, "Application quoted", data);
          break;

        case "application.declined":
          if (appRowId) {
            await pool.query(
              `UPDATE bi_applications SET stage='declined', updated_at=NOW() WHERE id=$1`,
              [appRowId]
            );
          }
          await writeActivity(appRowId, eventType, "Application declined", data);
          break;

        case "policy.bound":
          if (appRowId) {
            await pool.query(
              `UPDATE bi_applications SET stage='bound', updated_at=NOW() WHERE id=$1`,
              [appRowId]
            );
          }
          await writeActivity(appRowId, eventType, "Policy bound", data);
          break;

        case "claim.submitted":
        case "claim.status_changed":
        case "claim.closed":
          if (appRowId) {
            await pool.query(
              `UPDATE bi_applications SET stage='claim', updated_at=NOW() WHERE id=$1`,
              [appRowId]
            );
          }
          await writeActivity(appRowId, eventType, "Claim activity", data);
          break;

        case "support.message_received":
        case "support.ticket_closed":
          await writeActivity(appRowId, eventType, "Support event", data);
          break;

        default:
          await writeActivity(appRowId, eventType, "Unhandled PGI webhook event", data);
      }
    } catch (err) {
      logger.error({ err, webhookId, eventType }, "Failed processing PGI webhook");
    }

    return ok(res, { received: true });
  }
);

export default router;
