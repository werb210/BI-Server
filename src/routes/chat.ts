import { Router } from "express";
import OpenAI from "openai";
import { Pool } from "pg";
import twilio from "twilio";
import sgMail from "@sendgrid/mail";
import fetch from "node-fetch";
import { env } from "../platform/env";
import { logger } from "../platform/logger";
import { badRequest, ok } from "../utils/apiResponse";

const router = Router();

const openai = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY
    })
  : null;

const pool = new Pool({
  connectionString: env.DATABASE_URL
});

const twilioClient = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
  ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
  : null;

if (env.SENDGRID_API_KEY) {
  sgMail.setApiKey(env.SENDGRID_API_KEY);
}

function extractEmail(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

function extractReferral(text: string): string | null {
  const match = text.match(/ref[:\s]+([A-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

router.post("/maya-chat", async (req, res) => {
  try {
    const { message, utm_source, utm_medium, utm_campaign } = req.body;

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
        if (env.CRM_WEBHOOK_URL) {
          await fetch(env.CRM_WEBHOOK_URL, {
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

      if (twilioClient && env.TWILIO_FROM && env.ALERT_SMS_TO) {
        await twilioClient.messages.create({
          body: `New Maya Lead: ${email}`,
          from: env.TWILIO_FROM,
          to: env.ALERT_SMS_TO
        });
      }

      if (env.SENDGRID_API_KEY && env.SENDGRID_FROM) {
        await sgMail.send({
          to: email,
          from: env.SENDGRID_FROM,
          subject: "We Received Your PGI Inquiry",
          html: `
          <p>Thanks for contacting Boreal Insurance.</p>
          <p>A PGI specialist will contact you shortly.</p>
        `
        });
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
