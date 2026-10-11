// BI_SERVER_v784_TWILIO_SIGNATURE
// Twilio webhooks are public URLs. Without signature validation anyone could
// post a fake inbound SMS and opt a number out or move a contact's stage.
// Twilio signs the full public URL it called plus the POST params with the
// account auth token. Behind Azure's proxy the URL Express sees is not the
// one Twilio called, so try BI_PUBLIC_BASE_URL first, then the URL rebuilt
// from x-forwarded-proto / x-forwarded-host.
import type { NextFunction, Request, Response } from "express";
import twilio from "twilio";
import { logger } from "../platform/logger";

function firstHeader(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return String(v ?? "").split(",")[0].trim();
}

export function twilioCandidateUrls(req: Request): string[] {
  const urls: string[] = [];
  const base = String(process.env.BI_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (base) urls.push(`${base}${req.originalUrl}`);
  const proto = firstHeader(req.headers["x-forwarded-proto"]) || req.protocol;
  const host = firstHeader(req.headers["x-forwarded-host"]) || firstHeader(req.headers.host);
  if (host) urls.push(`${proto}://${host}${req.originalUrl}`);
  return Array.from(new Set(urls));
}

export function requireTwilioSignature(req: Request, res: Response, next: NextFunction) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    logger.error({ path: req.originalUrl }, "[twilioSignature] TWILIO_AUTH_TOKEN is unset; refusing Twilio webhook");
    return res.status(503).json({ error: "twilio_not_configured" });
  }
  const signature = String(req.header("x-twilio-signature") ?? "");
  if (!signature) return res.status(403).json({ error: "missing_signature" });
  const params = (req.body && typeof req.body === "object") ? (req.body as Record<string, unknown>) : {};
  const valid = twilioCandidateUrls(req).some((url) => {
    try {
      return twilio.validateRequest(authToken, signature, url, params);
    } catch {
      return false;
    }
  });
  if (!valid) return res.status(403).json({ error: "bad_signature" });
  return next();
}
