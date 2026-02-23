import { Router } from "express";
import OpenAI from "openai";
import { Pool } from "pg";
import twilio from "twilio";
import sgMail from "@sendgrid/mail";

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const SYSTEM_PROMPT = `
You are Maya, the AI assistant for Boreal Insurance.
You specialize in Personal Guarantee Insurance (PGI) in Canada.

Keep responses short and professional.
If user asks about cost, applying, eligibility or protection,
ask for their name and email so a specialist can contact them.
Never provide legal advice.
`;

function extractEmail(text: string): string | null {
  const match = text.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  );
  return match ? match[0] : null;
}

router.post("/maya-chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    const email = extractEmail(message);

    if (email) {
      await pool.query(
        `INSERT INTO maya_leads (email, last_message)
         VALUES ($1, $2)`,
        [email, message]
      );

      // SMS Alert to Team
      await twilioClient.messages.create({
        body: `New Maya PGI lead: ${email}`,
        from: process.env.TWILIO_FROM!,
        to: process.env.ALERT_SMS_TO!
      });

      // Confirmation Email to Prospect
      await sgMail.send({
        to: email,
        from: process.env.SENDGRID_FROM!,
        subject: "We Received Your PGI Inquiry",
        html: `
          <p>Thank you for contacting Boreal Insurance.</p>
          <p>A Personal Guarantee Insurance specialist will reach out shortly.</p>
          <p>If urgent, reply to this email.</p>
        `
      });

      return res.json({
        reply:
          "Thanks. I've captured your details. A PGI specialist will contact you shortly."
      });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message }
      ],
      temperature: 0.4
    });

    const reply =
      response.choices[0]?.message?.content ||
      "I'm sorry, I couldn't process that.";

    res.json({ reply });

  } catch (err) {
    console.error("Maya error:", err);
    res.status(500).json({ error: "Chat failure" });
  }
});

export default router;
