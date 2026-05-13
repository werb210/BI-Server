// BI_SERVER_BLOCK_v251_OUTREACH_CRM_v1
// Andrew's outreach CRM endpoints. Mounted under /api/v1/bi so
// the resolved paths are /api/v1/bi/crm/outreach/*.
// Auth: requireAuth (staff JWT). All writes capture req.user.staffUserId
// as the actor so the activity timeline shows who did what.
import express, { type Request, type Response } from "express";
import { pool } from "../db";
import { requireAuth } from "../platform/auth";
import { logger } from "../platform/logger";

const router = express.Router();
router.use(requireAuth);

const ALLOWED_STATUS = new Set([
  "cold",
  "attempting",
  "voicemail",
  "engaged",
  "demo_booked",
  "demo_completed",
  "not_interested",
  "lender",
]);

const ALLOWED_EVENT_TYPES = new Set([
  "call",
  "demo",
  "sms",
  "email",
  "note",
  "status_change",
  "import",
]);

function s(v: unknown, max = 1000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

function actorFrom(req: Request): { id: string | null; name: string | null } {
  const u = (req as any).user as Record<string, unknown> | undefined;
  const id = typeof u?.staffUserId === "string" ? u.staffUserId : null;
  const name =
    (typeof u?.displayName === "string" ? u.displayName : null) ??
    (typeof u?.full_name === "string" ? u.full_name : null);
  return { id, name };
}

// GET /crm/outreach/contacts
// Query params: status, owner, q (search on name/email/phone), limit (default 100, max 500)
router.get("/crm/outreach/contacts", async (req: Request, res: Response) => {
  const status = s(req.query.status);
  const owner = s(req.query.owner);
  const q = s(req.query.q);
  const limit = Math.min(
    500,
    Math.max(1, Number(req.query.limit) || 100),
  );

  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (status === "unassigned") {
    where.push(`outreach_status IS NULL`);
  } else if (status) {
    if (!ALLOWED_STATUS.has(status)) {
      return res.status(400).json({ ok: false, error: "invalid_status" });
    }
    where.push(`outreach_status = $${i++}`);
    params.push(status);
  }
  if (owner === "mine") {
    const { id } = actorFrom(req);
    if (!id) return res.status(400).json({ ok: false, error: "no_staff_user_id" });
    where.push(`outreach_owner_id = $${i++}`);
    params.push(id);
  } else if (owner === "unassigned") {
    where.push(`outreach_owner_id IS NULL`);
  } else if (owner) {
    where.push(`outreach_owner_id = $${i++}`);
    params.push(owner);
  }
  if (q) {
    where.push(`(
      full_name ILIKE $${i}
      OR email ILIKE $${i}
      OR phone_e164 ILIKE $${i}
    )`);
    params.push(`%${q}%`);
    i++;
  }

  const sql = `
    SELECT id, full_name, email, phone_e164, title, notes, tags,
           outreach_status, outreach_owner_id, outreach_updated_at,
           company_id, created_at
      FROM bi_contacts
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY COALESCE(outreach_updated_at, created_at) DESC
     LIMIT ${limit}
  `;
  try {
    const r = await pool.query(sql, params);
    return res.json({ ok: true, contacts: r.rows });
  } catch (e: any) {
    logger.error({ err: e }, "outreach_list_failed");
    return res.status(500).json({ ok: false, error: "list_failed" });
  }
});

// PATCH /crm/outreach/contacts/:id
// Body: { outreach_status?, outreach_owner_id?, title?, notes? }
// Status changes are auto-logged to bi_contact_activity.
router.patch("/crm/outreach/contacts/:id", async (req: Request, res: Response) => {
  const id = s(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "id_required" });

  const b: any = req.body ?? {};
  const newStatus = b.outreach_status === null ? null : s(b.outreach_status);
  const newOwner = b.outreach_owner_id === null ? null : s(b.outreach_owner_id);
  const title = b.title === null ? null : s(b.title);
  const notes = b.notes === null ? null : s(b.notes, 8000);

  if (newStatus && !ALLOWED_STATUS.has(newStatus)) {
    return res.status(400).json({ ok: false, error: "invalid_status" });
  }

  const existing = await pool.query<{ outreach_status: string | null }>(
    `SELECT outreach_status FROM bi_contacts WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (!existing.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
  const prevStatus = existing.rows[0].outreach_status;

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (b.outreach_status !== undefined) { sets.push(`outreach_status = $${i++}`); params.push(newStatus); }
  if (b.outreach_owner_id !== undefined) { sets.push(`outreach_owner_id = $${i++}`); params.push(newOwner); }
  if (b.title !== undefined) { sets.push(`title = $${i++}`); params.push(title); }
  if (b.notes !== undefined) { sets.push(`notes = $${i++}`); params.push(notes); }
  if (sets.length === 0) {
    return res.json({ ok: true, no_op: true });
  }
  sets.push(`outreach_updated_at = NOW()`);
  params.push(id);

  try {
    await pool.query(
      `UPDATE bi_contacts SET ${sets.join(", ")} WHERE id = $${i}`,
      params,
    );

    // Auto-log status changes for the activity timeline.
    if (b.outreach_status !== undefined && newStatus !== prevStatus) {
      const actor = actorFrom(req);
      await pool.query(
        `INSERT INTO bi_contact_activity
           (id, contact_id, actor_id, actor_name, event_type, outcome, body, meta)
         VALUES (gen_random_uuid(), $1, $2, $3, 'status_change', $4,
                 $5, $6::jsonb)`,
        [
          id,
          actor.id,
          actor.name,
          newStatus,
          `Status changed from ${prevStatus ?? "(unassigned)"} to ${newStatus ?? "(cleared)"}`,
          JSON.stringify({ from: prevStatus, to: newStatus }),
        ],
      );
    }
    return res.json({ ok: true });
  } catch (e: any) {
    if (typeof e?.message === "string" && e.message.includes("bi_contacts_outreach_status_check")) {
      return res.status(400).json({ ok: false, error: "invalid_status" });
    }
    logger.error({ err: e }, "outreach_patch_failed");
    return res.status(500).json({ ok: false, error: "patch_failed" });
  }
});

// POST /crm/outreach/contacts/:id/activity
// Body: { event_type, outcome?, body?, meta? }
// Generic logger. The SMS/demo-invite block (v252) will call this
// internally after sending so all activity flows through one table.
router.post("/crm/outreach/contacts/:id/activity", async (req: Request, res: Response) => {
  const id = s(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "id_required" });

  const b: any = req.body ?? {};
  const eventType = s(b.event_type);
  if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) {
    return res.status(400).json({ ok: false, error: "invalid_event_type" });
  }
  const outcome = s(b.outcome);
  const body = s(b.body, 8000);
  const meta = b.meta && typeof b.meta === "object" ? b.meta : null;

  try {
    const exists = await pool.query(
      `SELECT 1 FROM bi_contacts WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!exists.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });

    const actor = actorFrom(req);
    const r = await pool.query<{ id: string }>(
      `INSERT INTO bi_contact_activity
         (id, contact_id, actor_id, actor_name, event_type, outcome, body, meta)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id`,
      [id, actor.id, actor.name, eventType, outcome, body, meta ? JSON.stringify(meta) : null],
    );

    // Outcome → auto status bump (PROJECT_PLAN row 11).
    const OUTCOME_TO_STATUS: Record<string, string> = {
      spoke: "engaged",
      voicemail: "voicemail",
      booked: "demo_booked",
      not_interested: "not_interested",
    };
    if (outcome && OUTCOME_TO_STATUS[outcome]) {
      await pool.query(
        `UPDATE bi_contacts
            SET outreach_status = $1,
                outreach_updated_at = NOW()
          WHERE id = $2`,
        [OUTCOME_TO_STATUS[outcome], id],
      );
    }

    return res.json({ ok: true, activity_id: r.rows[0].id });
  } catch (e: any) {
    logger.error({ err: e }, "outreach_activity_failed");
    return res.status(500).json({ ok: false, error: "activity_failed" });
  }
});

// GET /crm/outreach/contacts/:id/activity — timeline for one contact
router.get("/crm/outreach/contacts/:id/activity", async (req: Request, res: Response) => {
  const id = s(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "id_required" });
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  try {
    const r = await pool.query(
      `SELECT id, contact_id, actor_id, actor_name, event_type,
              outcome, body, meta, created_at
         FROM bi_contact_activity
        WHERE contact_id = $1
        ORDER BY created_at DESC
        LIMIT ${limit}`,
      [id],
    );
    return res.json({ ok: true, events: r.rows });
  } catch (e: any) {
    logger.error({ err: e }, "outreach_timeline_failed");
    return res.status(500).json({ ok: false, error: "timeline_failed" });
  }
});

// GET /crm/outreach/me/profile — current staff member's profile
router.get("/crm/outreach/me/profile", async (req: Request, res: Response) => {
  const { id, name } = actorFrom(req);
  if (!id) return res.status(400).json({ ok: false, error: "no_staff_user_id" });
  try {
    const r = await pool.query(
      `SELECT staff_user_id, display_name, bookings_url, phone_e164,
              created_at, updated_at
         FROM bi_staff_profile
        WHERE staff_user_id = $1`,
      [id],
    );
    if (!r.rows[0]) {
      return res.json({
        ok: true,
        profile: {
          staff_user_id: id,
          display_name: name,
          bookings_url: null,
          phone_e164: null,
        },
        exists: false,
      });
    }
    return res.json({ ok: true, profile: r.rows[0], exists: true });
  } catch (e: any) {
    logger.error({ err: e }, "outreach_me_get_failed");
    return res.status(500).json({ ok: false, error: "profile_get_failed" });
  }
});

// PUT /crm/outreach/me/profile — upsert the current staff profile
router.put("/crm/outreach/me/profile", async (req: Request, res: Response) => {
  const { id } = actorFrom(req);
  if (!id) return res.status(400).json({ ok: false, error: "no_staff_user_id" });
  const b: any = req.body ?? {};
  const displayName = s(b.display_name);
  const bookingsUrl = s(b.bookings_url, 500);
  const phoneE164 = s(b.phone_e164, 32);
  if (bookingsUrl && !/^https:\/\//i.test(bookingsUrl)) {
    return res.status(400).json({ ok: false, error: "bookings_url_must_be_https" });
  }
  try {
    await pool.query(
      `INSERT INTO bi_staff_profile
         (staff_user_id, display_name, bookings_url, phone_e164, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (staff_user_id) DO UPDATE
         SET display_name = COALESCE(EXCLUDED.display_name, bi_staff_profile.display_name),
             bookings_url = COALESCE(EXCLUDED.bookings_url, bi_staff_profile.bookings_url),
             phone_e164   = COALESCE(EXCLUDED.phone_e164,   bi_staff_profile.phone_e164),
             updated_at   = NOW()`,
      [id, displayName, bookingsUrl, phoneE164],
    );
    return res.json({ ok: true });
  } catch (e: any) {
    logger.error({ err: e }, "outreach_me_put_failed");
    return res.status(500).json({ ok: false, error: "profile_put_failed" });
  }
});

export default router;
