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

export default router;
