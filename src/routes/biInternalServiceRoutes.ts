// BI_SERVER_v789_INTERNAL_SERVICE [31] - service-only routes for BF-Server.
// Mounted at /api/v1/bi/internal ABOVE the staff requireAuth mount on
// "/api/v1/bi". Only BF-Server service tokens pass (requireBfServiceToken):
// no/invalid token -> 401, staff/applicant/other tokens -> 403.
//
//   POST /outreach/advance { match: { id?, phone?, email? }, to }
//        -> { ok: true, updated }   forward-only outreach_status bump
//   GET  /outreach/contacts/:id
//        -> { full_name, email, phone_e164, company_id }
import { Router, type Request, type Response } from "express";
import { pool } from "../db";
import { requireBfServiceToken } from "../platform/serviceTokens";
import { logHiddenError } from "../platform/safeError";

const router = Router();
router.use(requireBfServiceToken);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Forward-only: the statuses each target may be reached from (NULL is always allowed).
export const OUTREACH_ADVANCE_FROM: Record<string, readonly string[]> = {
  contacted: ["new", "cold", "attempting", "voicemail"],
  engaged: ["new", "contacted"],
  demo_booked: ["new", "contacted", "engaged"],
};

router.post("/outreach/advance", async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as { match?: unknown; to?: unknown };
  const to = typeof b.to === "string" ? b.to : "";
  const allowedFrom = OUTREACH_ADVANCE_FROM[to];
  if (!allowedFrom) return res.status(400).json({ ok: false, error: "invalid_to" });
  const match = b.match && typeof b.match === "object" && !Array.isArray(b.match) ? (b.match as Record<string, unknown>) : null;
  if (!match) return res.status(400).json({ ok: false, error: "match_required" });

  const conds: string[] = [];
  const params: unknown[] = [to, allowedFrom];
  if (match.id !== undefined && match.id !== null && match.id !== "") {
    if (typeof match.id !== "string" || !UUID_RE.test(match.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
    params.push(match.id);
    conds.push(`id = $${params.length}::uuid`);
  }
  if (match.phone !== undefined && match.phone !== null && match.phone !== "") {
    const digits = typeof match.phone === "string" || typeof match.phone === "number" ? String(match.phone).replace(/\D/g, "") : "";
    if (digits.length < 10) return res.status(400).json({ ok: false, error: "invalid_phone" });
    params.push(digits.slice(-10));
    conds.push(`(phone_e164 IS NOT NULL AND right(regexp_replace(phone_e164, '\\D', '', 'g'), 10) = $${params.length})`);
  }
  if (match.email !== undefined && match.email !== null && match.email !== "") {
    const email = typeof match.email === "string" ? match.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: "invalid_email" });
    params.push(email);
    conds.push(`(email IS NOT NULL AND lower(trim(email)) = $${params.length})`);
  }
  if (!conds.length) return res.status(400).json({ ok: false, error: "match_required" });

  try {
    // One atomic UPDATE: the allowed-from list is in the WHERE, so a concurrent
    // move to a later status is never overwritten.
    const r = await pool.query(
      `UPDATE bi_contacts
          SET outreach_status = $1,
              outreach_updated_at = now()
        WHERE (${conds.join(" OR ")})
          AND (outreach_status IS NULL OR outreach_status = ANY($2::text[]))`,
      params,
    );
    return res.json({ ok: true, updated: r.rowCount ?? 0 });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "advance_failed", requestId: logHiddenError(req, err, "internal_outreach_advance_failed") });
  }
});

router.get("/outreach/contacts/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  try {
    const r = await pool.query(
      `SELECT full_name, email, phone_e164, company_id FROM bi_contacts WHERE id = $1 LIMIT 1`,
      [id],
    );
    const row = r.rows[0] as { full_name: string | null; email: string | null; phone_e164: string | null; company_id: string | null } | undefined;
    if (!row) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ full_name: row.full_name, email: row.email, phone_e164: row.phone_e164, company_id: row.company_id });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "lookup_failed", requestId: logHiddenError(req, err, "internal_outreach_contact_failed") });
  }
});


// BI_SERVER_ENGAGEMENT_v1 - BF-Server tells us about replies it found in any staff or shared mailbox and about bookings,
// matched by email to contacts the PGI flows reached; and reads each owner's morning numbers for the digest.
//   POST /engagement/reply { email, at, subject?, body?, mailbox? }   -> { ok, matched, kinds }
//   POST /engagement/event { email, kind: "booked", at?, start? }      -> { ok, matched }
//   GET  /engagement/digest?owner=<BF user id>                         -> { ok, digest }
//   GET  /engagement/owners                                            -> { ok, owners }
//   GET  /engagement/leaks?days=7                                      -> { ok, leaks }
router.post("/engagement/reply", async (req: Request, res: Response) => {
  try {
    const { contactIdsByEmail, recordReply } = await import("../services/engagement/engagement");
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const at = new Date(String(req.body?.at ?? ""));
    if (!EMAIL_RE.test(email) || Number.isNaN(at.getTime())) return res.status(400).json({ ok: false, error: "email_and_at_required" });
    const kinds: string[] = [];
    for (const id of await contactIdsByEmail(pool, email)) {
      const k = await recordReply(pool, { contactId: id, at, subject: req.body?.subject ?? null, body: req.body?.body ?? null, mailbox: req.body?.mailbox ?? null });
      if (k) kinds.push(k);
    }
    // A real reply also stops their PGI emails (the flows only read their own reply-to mailbox).
    if (kinds.length) {
      await pool.query(
        `UPDATE bi_flow_members SET status = 'stopped', stop_reason = 'replied', next_key = NULL, next_at = NULL, updated_at = now()
          WHERE lower(email) = $1 AND status IN ('active', 'queued') AND first_sent_at IS NOT NULL AND first_sent_at < $2`, [email, at]);
    }
    res.json({ ok: true, matched: kinds.length, kinds });
  } catch (err) { res.status(500).json({ ok: false, error: "engagement_reply_failed", requestId: logHiddenError(req, err, "engagement_reply_failed") }); }
});
router.post("/engagement/event", async (req: Request, res: Response) => {
  try {
    const { contactIdsByEmail, recordEvent } = await import("../services/engagement/engagement");
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const kind = String(req.body?.kind ?? "");
    if (!EMAIL_RE.test(email) || kind !== "booked") return res.status(400).json({ ok: false, error: "email_and_kind_required" });
    const at = req.body?.at ? new Date(String(req.body.at)) : new Date();
    let matched = 0;
    for (const id of await contactIdsByEmail(pool, email)) {
      // Only people the flows reached count as outreach bookings.
      const reached = await pool.query(`SELECT 1 FROM bi_engagement WHERE contact_id = $1 UNION ALL SELECT 1 FROM bi_flow_members WHERE contact_id = $1 AND first_sent_at IS NOT NULL LIMIT 1`, [id]);
      if (!reached.rowCount) continue;
      if (await recordEvent(pool, { contactId: id, kind: "booked", at, detail: { start: req.body?.start ?? null, source: String(req.body?.source ?? "booking").slice(0, 60) }, actor: "Booking" })) matched += 1;
    }
    res.json({ ok: true, matched });
  } catch (err) { res.status(500).json({ ok: false, error: "engagement_event_failed", requestId: logHiddenError(req, err, "engagement_event_failed") }); }
});
router.get("/engagement/digest", async (req: Request, res: Response) => {
  try {
    const { digestFor } = await import("../services/engagement/engagement");
    const owner = String(req.query.owner ?? "").trim();
    if (!owner) return res.status(400).json({ ok: false, error: "owner_required" });
    res.json({ ok: true, digest: await digestFor(pool, owner) });
  } catch (err) { res.status(500).json({ ok: false, error: "engagement_digest_failed", requestId: logHiddenError(req, err, "engagement_digest_failed") }); }
});
router.get("/engagement/owners", async (req: Request, res: Response) => {
  try {
    const { owners } = await import("../services/engagement/engagement");
    res.json({ ok: true, owners: await owners(pool) });
  } catch (err) { res.status(500).json({ ok: false, error: "engagement_owners_failed", requestId: logHiddenError(req, err, "engagement_owners_failed") }); }
});

router.get("/engagement/leaks", async (req: Request, res: Response) => {
  try {
    const { funnel } = await import("../services/engagement/engagement");
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    res.json({ ok: true, leaks: (await funnel(pool, new Date(Date.now() - days * 86_400_000))).leaks });
  } catch (err) { res.status(500).json({ ok: false, error: "engagement_leaks_failed", requestId: logHiddenError(req, err, "engagement_leaks_failed") }); }
});

export default router;
