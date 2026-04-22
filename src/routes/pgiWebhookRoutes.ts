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
    [key: string]: unknown;
  };
};

const router = express.Router();

function parseSignature(signatureHeader: string | undefined): { timestamp: string; signature: Buffer } | null {
  if (!signatureHeader) {
    return null;
  }

  const pieces = signatureHeader.split(",").map((v) => v.trim());
  const t = pieces.find((p) => p.startsWith("t="))?.slice(2);
  const v1 = pieces.find((p) => p.startsWith("v1="))?.slice(3);

  if (!t || !v1) {
    return null;
  }

  try {
    return { timestamp: t, signature: Buffer.from(v1, "base64") };
  } catch {
    return null;
  }
}

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.PGI_WEBHOOK_SECRET) {
    return false;
  }

  const parsed = parseSignature(signatureHeader);
  if (!parsed) {
    return false;
  }

  const signedPayload = `${parsed.timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", env.PGI_WEBHOOK_SECRET).update(signedPayload).digest();

  if (expected.length !== parsed.signature.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, parsed.signature);
}

async function writeActivity(applicationId: string | null, eventType: string, summary: string, meta: object = {}) {
  await pool.query(
    `INSERT INTO bi_activity(application_id, actor_type, event_type, summary, meta)
     VALUES($1, 'system', $2, $3, $4::jsonb)`,
    [applicationId, eventType, summary, JSON.stringify(meta)]
  );
}

router.post("/api/v1/bi/webhooks/pgi", express.raw({ type: "application/json" }), async (req, res) => {
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

  const webhookId = event.id || crypto.createHash("sha256").update(rawBody).digest("hex");
  const applicationId = (event.data?.application_id as string | undefined) ?? null;

  try {
    await pool.query(
      `INSERT INTO bi_webhook_log (pgi_webhook_id, event_type, payload, processed_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (pgi_webhook_id)
       DO NOTHING`,
      [webhookId, event.type ?? "unknown", JSON.stringify(event)]
    );

    switch (event.type) {
      case "application.quoted":
        if (applicationId) {
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
              applicationId,
              JSON.stringify(event.data ?? {}),
              (event.data?.quote_expiry_at as string | undefined) ?? null,
              (event.data?.underwriter_ref as string | undefined) ?? null,
              (event.data?.coverage_amount as string | number | undefined) ?? null,
              (event.data?.annual_premium as string | number | undefined) ?? null,
              (event.data?.core_score as string | number | undefined) ?? null
            ]
          );
        }
        await writeActivity(applicationId, event.type, "Application quoted", event.data ?? {});
        break;
      case "application.declined":
        if (applicationId) await pool.query(`UPDATE bi_applications SET stage='declined' WHERE id=$1`, [applicationId]);
        await writeActivity(applicationId, event.type, "Application declined", event.data ?? {});
        break;
      case "application.under_review":
        if (applicationId) await pool.query(`UPDATE bi_applications SET stage='under_review' WHERE id=$1`, [applicationId]);
        await writeActivity(applicationId, event.type, "Application under review", event.data ?? {});
        break;
      case "policy.bound":
        if (applicationId) await pool.query(`UPDATE bi_applications SET stage='approved' WHERE id=$1`, [applicationId]);
        await writeActivity(applicationId, event.type, "Policy bound (approved)", event.data ?? {});
        break;
      case "policy.issued":
        if (applicationId) await pool.query(`UPDATE bi_applications SET stage='policy_issued' WHERE id=$1`, [applicationId]);
        await writeActivity(applicationId, event.type, "Policy issued", event.data ?? {});
        break;
      case "claim.submitted":
      case "claim.updated":
        if (applicationId) await pool.query(`UPDATE bi_applications SET stage='claim' WHERE id=$1`, [applicationId]);
        await writeActivity(applicationId, event.type, "Claim activity", event.data ?? {});
        break;
      default:
        await writeActivity(applicationId, event.type ?? "unknown", "Unhandled PGI webhook event", event.data ?? {});
    }
  } catch (err) {
    logger.error({ err, webhookId, eventType: event.type }, "Failed processing PGI webhook");
  }

  return ok(res, { received: true });
});

export default router;
