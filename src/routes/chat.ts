import { Router } from "express";
import OpenAI from "openai";
import { Pool } from "pg";

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const SYSTEM_PROMPT = `
You are Maya, the AI assistant for Boreal Insurance.

You specialize in Personal Guarantee Insurance (PGI) in Canada.

Rules:
- Keep responses short and professional.
- If the user shows intent (asks about cost, applying, eligibility),
  ask for their name and email so a specialist can contact them.
- If they provide email or phone, confirm capture and say a specialist will reach out.
- Never give legal advice.
`;

function extractEmail(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
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

    const reply = response.choices[0]?.message?.content || "I couldn't process that.";

    return res.json({ reply });
  } catch (err) {
    console.error("Maya error:", err);
    return res.status(500).json({ error: "Chat failure" });
  }
});

export default router;
