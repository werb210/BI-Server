import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const SYSTEM_PROMPT = `
You are Maya, the AI assistant for Boreal Insurance.

You specialize in Personal Guarantee Insurance (PGI) in Canada.

Your job:
- Explain what PGI is.
- Explain who needs it (business owners signing personal guarantees).
- Explain how it protects personal assets.
- Keep answers short, clear, professional.
- Encourage users to apply or speak to a specialist when appropriate.
- Never provide legal advice.
- Never discuss unrelated products.
`;

router.post("/maya-chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
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

    return res.json({ reply });
  } catch (err) {
    console.error("Maya chat error:", err);
    return res.status(500).json({ error: "Chat failure" });
  }
});

export default router;
