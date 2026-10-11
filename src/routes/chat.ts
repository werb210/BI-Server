import { Router } from "express";
import OpenAI from "openai";
import { pool as sharedPool } from "../db"; // BI_SERVER_ONE_POOL_v718 - one pool for the whole server
import twilio from "twilio";
import sgMail from "@sendgrid/mail";
import fetch from "node-fetch";
import { env } from "../platform/env";
import { logger } from "../platform/logger";
import { badRequest, ok } from "../utils/apiResponse";
import { ipRateLimit, clientIpKey } from "../lib/ipRateLimit"; // BI_SERVER_v789_PUBLIC_RATE_LIMITS
import { staffAlertAllowed } from "../services/staffNotifyService"; // BI_SERVER_v789_STAFF_ALERT_THROTTLE
import { maskEmail } from "../util/mask";

const router = Router();

const openai = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY
    })
  : null;

const pool = sharedPool /* BI_SERVER_ONE_POOL_v718 */;

const twilioClient = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
  ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
  : null;

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

function extractEmail(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

function extractReferral(text: string): string | null {
  const match = text.match(/ref[:\s]+([A-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

// BI_SERVER_v789_PUBLIC_RATE_LIMITS - 5 per minute and 30 per day per client
// IP. Per route: this router is mounted at "/api/v1" and sees every request.
export const mayaChatMinuteLimiter = ipRateLimit({ windowMs: 60 * 1000, limit: 5 });
export const mayaChatDayLimiter = ipRateLimit({ windowMs: 24 * 60 * 60 * 1000, limit: 30 });

// BI_SERVER_v789_MAYA_EMAIL_ONCE - Maya used to send the "We received your PGI
// inquiry" email to ANY address found in a message, on every message, so the
// chat could be used to mail strangers. Now:
//   - the recipient must be the address the visitor gave as THEIR OWN in this
//     conversation: the `email` field of the request, or a message that says so
//     ("my email is ...", "reach me at ...", or a message that is only the
//     address). The first such address is the conversation's; it does not change;
//   - and at most one email per conversation id. The conversation id is the
//     body's conversation_id / conversationId / session_id / sessionId; without
//     one, the client IP stands in for it.
// State is in memory (per instance), kept 24 hours.
const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;
const CONVERSATION_MAX = 20_000;
type ConversationState = { ownEmail: string | null; emailed: boolean; seenAt: number };
const conversations = new Map<string, ConversationState>();

function conversationKey(body: Record<string, unknown>, ip: string): string {
  for (const k of ["conversation_id", "conversationId", "session_id", "sessionId"]) {
    const v = body[k];
    if (typeof v === "string" && /^[A-Za-z0-9_.:-]{6,128}$/.test(v.trim())) return `c:${v.trim()}`;
  }
  return `ip:${ip}`;
}

function conversationState(key: string, now: number): ConversationState {
  let st = conversations.get(key);
  if (st && now - st.seenAt > CONVERSATION_TTL_MS) {
    conversations.delete(key);
    st = undefined;
  }
  if (!st) {
    if (conversations.size >= CONVERSATION_MAX) {
      for (const [k, v] of conversations) if (now - v.seenAt > CONVERSATION_TTL_MS) conversations.delete(k);
      while (conversations.size >= CONVERSATION_MAX) {
        const first = conversations.keys().next().value;
        if (first === undefined) break;
        conversations.delete(first);
      }
    }
    st = { ownEmail: null, emailed: false, seenAt: now };
    conversations.set(key, st);
  }
  st.seenAt = now;
  return st;
}

/** Test hook. */
export function resetMayaConversations(): void {
  conversations.clear();
}

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const EMAIL_IN_TEXT = "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}";
const OWN_EMAIL_PHRASES = new RegExp(
  "(?:\\bmy\\s+(?:e-?mail|email\\s+address|address)\\s*(?:is|:|=)?|\\b(?:e-?mail|reach|contact|write\\s+to)\\s+me\\s+(?:at|on|via)|\\b(?:i\\s+am|i'm|im)\\s+at|\\bmy\\s+e-?mail\\b[^@]{0,20}?)\\s*(" + EMAIL_IN_TEXT + ")",
  "i",
);

/** The address the visitor states as their own, or null. */
export function ownEmailFrom(body: Record<string, unknown>, message: string): string | null {
  const field = typeof body.email === "string" ? body.email.trim() : "";
  if (field && EMAIL_RE.test(field)) return field.toLowerCase();
  const text = String(message ?? "").trim();
  if (EMAIL_RE.test(text)) return text.toLowerCase();
  const m = text.match(OWN_EMAIL_PHRASES);
  return m ? m[1].toLowerCase() : null;
}

router.post("/maya-chat", mayaChatMinuteLimiter, mayaChatDayLimiter, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, any>;
    const { message, utm_source, utm_medium, utm_campaign } = body;
    const ip = clientIpKey(req);

    if (!message) {
      return badRequest(res, "Message required");
    }

    const email = extractEmail(message);
    const referral = extractReferral(message);

    if (email) {
      const insert = await pool.query(
        `INSERT INTO maya_leads
         (email, last_message, referral_code, utm_source, utm_medium, utm_campaign)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [email, message, referral, utm_source, utm_medium, utm_campaign]
      );

      const leadId = insert.rows[0].id;

      try {
        if (process.env.CRM_WEBHOOK_URL) {
          await fetch(process.env.CRM_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              leadId,
              email,
              referral,
              utm_source,
              utm_medium,
              utm_campaign,
              source: "Maya Chat"
            })
          });
        }

        await pool.query(`UPDATE maya_leads SET crm_status='sent' WHERE id=$1`, [leadId]);
      } catch {
        await pool.query(`UPDATE maya_leads SET crm_status='failed' WHERE id=$1`, [leadId]);
      }

      // BI_SERVER_v789_STAFF_ALERT_THROTTLE - one staff text per sender IP per 10 minutes.
      if (twilioClient && env.TWILIO_FROM && env.ALERT_SMS_TO && staffAlertAllowed([`ip:${ip}`])) {
        try {
          await twilioClient.messages.create({
            body: `New Maya Lead: ${email}`,
            from: env.TWILIO_FROM,
            to: env.ALERT_SMS_TO
          });
        } catch (err) {
          logger.error({ err }, "maya staff alert failed");
        }
      }

      // BI_SERVER_v789_MAYA_EMAIL_ONCE
      const conv = conversationState(conversationKey(body, ip), Date.now());
      if (!conv.ownEmail) conv.ownEmail = ownEmailFrom(body, String(message));
      const recipient = email.toLowerCase();
      if (
        process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM &&
        conv.ownEmail && conv.ownEmail === recipient && !conv.emailed
      ) {
        conv.emailed = true;
        try {
          await sgMail.send({
            to: conv.ownEmail,
            from: process.env.SENDGRID_FROM,
            subject: "We Received Your PGI Inquiry",
            html: `
          <p>Thanks for contacting Boreal Insurance.</p>
          <p>A PGI specialist will contact you shortly.</p>
        `
          });
        } catch (err) {
          logger.error({ err, to: maskEmail(conv.ownEmail) }, "maya confirmation email failed");
        }
      }

      return ok(res, {
        reply: "Thanks. I've captured your details. A specialist will contact you shortly."
      });
    }

    if (!openai) {
      return ok(res, {
        reply: "Thanks for reaching out. Please include your email and our team will follow up shortly."
      });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are Maya for Boreal Insurance. Keep answers short and PGI focused."
        },
        { role: "user", content: message }
      ],
      temperature: 0.4
    });

    return ok(res, {
      reply: response.choices[0]?.message?.content || "I'm sorry, I couldn't process that."
    });
  } catch (err) {
    logger.error({ err }, "Maya error");
    return badRequest(res, "Chat failure");
  }
});

export default router;
