// BI_SERVER_BLOCK_v568_BI_VISITOR_JOURNEY - public collector for boreal.insure.
// Accepts text/plain (a CORS "simple" request, so beacons never need a preflight).
// Never errors to the browser: tracking must not break the site.
import express, { Router } from "express";
import { pool } from "../db";
import { parseJourneyBody, publicIdFromPath } from "../services/biVisitorJourney";

const router = Router();
router.post("/track/journey", express.text({ type: "*/*", limit: "32kb" }), async (req, res) => {
  try {
    const p = parseJourneyBody(req.body);
    if (!p) return res.json({ ok: true, skipped: "no_session" });
    const a = p.attribution as Record<string, any>;
    const s = (v: unknown, n = 512) => (typeof v === "string" && v ? v.slice(0, n) : null);
    const linked = p.events.map((e) => publicIdFromPath(e.path)).find(Boolean) ?? null;
    await pool.query(
      `INSERT INTO bi_visitor_sessions (session_id, public_id, landing_page, referrer, gclid, utm_source, utm_medium, utm_campaign, utm_term, utm_content, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (session_id) DO UPDATE SET last_seen_at = NOW(),
         public_id = COALESCE(bi_visitor_sessions.public_id, EXCLUDED.public_id)`,
      [p.sessionId, linked, s(a.landing_page), s(a.referrer), s(a.gclid, 200), s(a.utm_source), s(a.utm_medium),
        s(a.utm_campaign), s(a.utm_term), s(a.utm_content), s(req.headers["user-agent"], 300)],
    );
    for (const e of p.events) {
      await pool.query(
        `INSERT INTO bi_visitor_events (session_id, event_type, path, title, step, dwell_ms) VALUES ($1,$2,$3,$4,$5,$6)`,
        [p.sessionId, e.type, e.path ?? null, e.title ?? null, e.step ?? null, e.dwellMs ?? null],
      );
    }
    return res.json({ ok: true, events: p.events.length });
  } catch {
    return res.json({ ok: true, skipped: "error" });
  }
});
export default router;
