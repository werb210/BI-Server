// BI_SERVER_BLOCK_v251_OUTREACH_CRM_v1
// Andrew's outreach CRM endpoints. Mounted under /api/v1/bi so
// the resolved paths are /api/v1/bi/crm/outreach/*.
// Auth: requireAuth (staff JWT). All writes capture req.user.staffUserId
// as the actor so the activity timeline shows who did what.
import express, { type Request, type Response } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { pool } from "../db";
import { requireAuth } from "../platform/auth";
import { logger } from "../platform/logger";
import { sendOutreachSms } from "../services/smsService";

const router = express.Router();
router.use(requireAuth);

// BI_SERVER_BLOCK_v252_OUTREACH_IMPORT_AND_INVITE_v1
// 10 MB cap is plenty for typical outreach lists (tens of
// thousands of rows compress well into XLSX). Memory storage
// because we parse and discard inline.
const outreachUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const ALLOWED_STATUS = new Set([
  "cold",
  "attempting",
  "voicemail",
  "engaged",
  "demo_booked",
  "demo_completed",
  "not_interested",
  "lender",
  "new",
  "contacted",
  "onboarding",
  "active",
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
  const offset = Math.max(0, Number(req.query.offset) || 0); // BI_SERVER_BLOCK_v791_OUTREACH_PAGINATION

  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  // BI_SERVER_BLOCK_v346_OUTREACH_TAG_FILTER — the outreach pipeline only ever shows
  // contacts tagged as a lender or broker (plain 'lender'/'broker' or namespaced
  // 'lender:<id>'/'lender_contact:<id>'). Untagged contacts are excluded.
  where.push(
    `EXISTS (SELECT 1 FROM unnest(coalesce(tags, ARRAY[]::text[])) AS t WHERE lower(t) LIKE 'lender%' OR lower(t) LIKE 'broker%')`,
  );

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
           outreach_segment, promoted_lender_id, -- BI_SERVER_BLOCK_v411
           company_id, created_at,
           (SELECT COALESCE(co.operating_name, co.legal_name) FROM bi_companies co WHERE co.id = bi_contacts.company_id) AS company_name -- BI_SERVER_BLOCK_v349_OUTREACH_COMPANY
      FROM bi_contacts
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY COALESCE(outreach_updated_at, created_at) DESC
     LIMIT ${limit}
     OFFSET ${offset}
  `;
  const countSql = `SELECT COUNT(*)::int AS total FROM bi_contacts ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`; // BI_SERVER_BLOCK_v791_OUTREACH_PAGINATION
  try {
    const r = await pool.query(sql, params);
    const c = await pool.query(countSql, params);
    const total = c.rows[0]?.total ?? r.rows.length;
    return res.json({ ok: true, contacts: r.rows, total, limit, offset, hasMore: offset + r.rows.length < total });
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

// BI_SERVER_BLOCK_v252_OUTREACH_IMPORT_AND_INVITE_v1
// POST /crm/outreach/import — Excel/CSV upload.
// Multipart form field name is "file". The XLSX lib auto-detects
// CSV vs XLSX from the buffer. Accepted columns (case-insensitive,
// any underscore/space/dash flavor): full_name (required),
// company_name, email, phone_e164 (alias: phone), title (alias:
// role), tags (comma-separated), notes.
function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_");
}
const HEADER_ALIASES: Record<string, string> = {
  full_name: "full_name",
  name: "full_name",
  contact_name: "full_name",
  company: "company_name",
  company_name: "company_name",
  organization: "company_name",
  email: "email",
  email_address: "email",
  phone: "phone_e164",
  phone_e164: "phone_e164",
  mobile: "phone_e164",
  title: "title",
  role: "title",
  job_title: "title",
  tags: "tags",
  notes: "notes",
  note: "notes",
};

function normalizePhone(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  if (!s) return null;
  const digits = s.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

router.post(
  "/crm/outreach/import",
  outreachUpload.single("file"),
  async (req: Request, res: Response) => {
    const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
    if (!file) return res.status(400).json({ ok: false, error: "file_required" });

    let rows: Array<Record<string, unknown>> = [];
    try {
      const wb = XLSX.read(file.buffer, { type: "buffer" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        return res.status(400).json({ ok: false, error: "no_sheets_in_file" });
      }
      rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null, raw: false });
    } catch (e: any) {
      logger.error({ err: e, file: file.originalname }, "outreach_import_parse_failed");
      return res.status(400).json({ ok: false, error: "parse_failed", detail: e?.message });
    }

    if (!rows.length) {
      return res.status(400).json({ ok: false, error: "no_rows" });
    }

    const actor = ((req as any).user ?? {}) as { staffUserId?: string };
    const ownerId = typeof actor.staffUserId === "string" ? actor.staffUserId : null;

    const results: Array<{ row: number; ok: boolean; id?: string; error?: string }> = [];
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] ?? {};
      const norm: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        const alias = HEADER_ALIASES[normalizeHeader(k)];
        if (alias) norm[alias] = v;
      }
      const fullName =
        typeof norm.full_name === "string" ? norm.full_name.trim() : "";
      if (!fullName) {
        results.push({ row: i + 2, ok: false, error: "missing_full_name" });
        skipped++;
        continue;
      }
      const email =
        typeof norm.email === "string" && norm.email.trim().length
          ? norm.email.trim()
          : null;
      const phone = normalizePhone(norm.phone_e164);
      const companyName =
        typeof norm.company_name === "string" && norm.company_name.trim().length
          ? norm.company_name.trim()
          : null;
      const title =
        typeof norm.title === "string" && norm.title.trim().length
          ? norm.title.trim()
          : null;
      const notes =
        typeof norm.notes === "string" && norm.notes.trim().length
          ? norm.notes.trim().slice(0, 8000)
          : null;
      const tagsRaw = typeof norm.tags === "string" ? norm.tags : "";
      const tags = tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      try {
        let companyId: string | null = null;
        if (companyName) {
          const found = await pool.query<{ id: string }>(
            `SELECT id FROM bi_companies WHERE lower(legal_name) = lower($1) LIMIT 1`,
            [companyName],
          );
          if (found.rows[0]) {
            companyId = found.rows[0].id;
          } else {
            const created = await pool.query<{ id: string }>(
              `INSERT INTO bi_companies (legal_name) VALUES ($1) RETURNING id`,
              [companyName],
            );
            companyId = created.rows[0].id;
          }
        }

        const ins = await pool.query<{ id: string }>(
          `INSERT INTO bi_contacts
             (company_id, full_name, email, phone_e164, tags,
              title, notes, outreach_status, outreach_owner_id, outreach_updated_at)
           VALUES ($1, $2, $3, $4, $5::text[], $6, $7, 'cold', $8, NOW())
           RETURNING id`,
          [companyId, fullName, email, phone, tags, title, notes, ownerId],
        );
        const contactId = ins.rows[0].id;

        await pool.query(
          `INSERT INTO bi_contact_activity
             (id, contact_id, actor_id, event_type, body, meta)
           VALUES (gen_random_uuid(), $1, $2, 'import', $3, $4::jsonb)`,
          [
            contactId,
            ownerId,
            `Imported from ${file.originalname}`,
            JSON.stringify({ row: i + 2, source: file.originalname }),
          ],
        );

        results.push({ row: i + 2, ok: true, id: contactId });
        imported++;
      } catch (e: any) {
        logger.error({ err: e, row: i + 2 }, "outreach_import_row_failed");
        results.push({ row: i + 2, ok: false, error: e?.message ?? "insert_failed" });
        skipped++;
      }
    }

    return res.json({
      ok: true,
      imported,
      skipped,
      total: rows.length,
      results,
    });
  },
);

// BI_SERVER_BLOCK_v252_OUTREACH_IMPORT_AND_INVITE_v1
// POST /crm/outreach/contacts/:id/demo-invite — send demo invite SMS.
// Body: { custom_message?: string }
// Reads the staff member's bookings_url from bi_staff_profile and
// SMSes it to the contact's phone_e164. Logs 'sms' to the activity
// timeline. Status auto-bumps to 'attempting' if currently null/cold,
// and to 'demo_booked' would be premature here (the contact hasn't
// confirmed yet), so we stop at 'attempting'.
router.post(
  "/crm/outreach/contacts/:id/demo-invite",
  async (req: Request, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    if (!id) return res.status(400).json({ ok: false, error: "id_required" });

    const actor = ((req as any).user ?? {}) as { staffUserId?: string };
    const staffId = typeof actor.staffUserId === "string" ? actor.staffUserId : null;
    if (!staffId) return res.status(400).json({ ok: false, error: "no_staff_user_id" });

    // Look up staff bookings_url + contact phone in one round trip.
    let bookingsUrl: string | null = null;
    let contactPhone: string | null = null;
    let contactName: string | null = null;
    let contactStatus: string | null = null;
    try {
      const sp = await pool.query<{ bookings_url: string | null }>(
        `SELECT bookings_url FROM bi_staff_profile WHERE staff_user_id = $1 LIMIT 1`,
        [staffId],
      );
      bookingsUrl = sp.rows[0]?.bookings_url ?? null;

      const cr = await pool.query<{
        phone_e164: string | null;
        full_name: string;
        outreach_status: string | null;
      }>(
        `SELECT phone_e164, full_name, outreach_status FROM bi_contacts WHERE id = $1 LIMIT 1`,
        [id],
      );
      if (!cr.rows[0]) return res.status(404).json({ ok: false, error: "contact_not_found" });
      contactPhone = cr.rows[0].phone_e164;
      contactName = cr.rows[0].full_name;
      contactStatus = cr.rows[0].outreach_status;
    } catch (e: any) {
      logger.error({ err: e, id }, "outreach_invite_lookup_failed");
      return res.status(500).json({ ok: false, error: "lookup_failed" });
    }

    if (!bookingsUrl) {
      return res.status(400).json({ ok: false, error: "bookings_url_missing" });
    }
    if (!contactPhone) {
      return res.status(400).json({ ok: false, error: "contact_has_no_phone" });
    }

    const customMessage =
      typeof req.body?.custom_message === "string"
        ? req.body.custom_message.trim().slice(0, 400)
        : "";
    const firstName = (contactName ?? "").split(/\s+/)[0] || "there";
    const body = customMessage.length
      ? `${customMessage}

Book a time: ${bookingsUrl}`
      : `Hi ${firstName}, this is Boreal Insurance. Pick a 30-minute slot that works for you: ${bookingsUrl}`;

    let sid: string | null = null;
    let smsOk = false;
    let smsError: string | null = null;
    try {
      const r = await sendOutreachSms(contactPhone, body);
      sid = r.sid;
      smsOk = true;
    } catch (e: any) {
      smsError = e?.message ?? "sms_failed";
      logger.error({ err: e, to: contactPhone }, "outreach_invite_sms_failed");
    }

    // Log the attempt regardless of outcome.
    try {
      await pool.query(
        `INSERT INTO bi_contact_activity
           (id, contact_id, actor_id, event_type, outcome, body, meta)
         VALUES (gen_random_uuid(), $1, $2, 'sms', $3, $4, $5::jsonb)`,
        [
          id,
          staffId,
          smsOk ? "sent" : "failed",
          body.slice(0, 1000),
          JSON.stringify({ sid, kind: "demo_invite", error: smsError }),
        ],
      );
    } catch (e: any) {
      logger.error({ err: e, id }, "outreach_invite_log_failed");
    }

    if (!smsOk) {
      return res.status(502).json({ ok: false, error: "sms_failed", detail: smsError });
    }

    // Auto-bump status if appropriate.
    if (contactStatus == null || contactStatus === "cold") {
      try {
        await pool.query(
          `UPDATE bi_contacts
              SET outreach_status = 'attempting',
                  outreach_updated_at = NOW()
            WHERE id = $1`,
          [id],
        );
      } catch (e: any) {
        logger.error({ err: e, id }, "outreach_invite_status_bump_failed");
      }
    }

    return res.json({ ok: true, sid, body });
  },
);

// BI_SERVER_BLOCK_v410_START_ONBOARDING_v1
// Promote an outreach contact to a lender using the same bi_lenders
// insert shape as the admin/lenders create path, then link the new
// lender back onto the contact to prevent double onboarding.
router.post(
  "/crm/outreach/contacts/:id/start-onboarding",
  async (req: Request, res: Response) => {
    const contactId = typeof req.params.id === "string" ? req.params.id : "";
    if (!contactId) return res.status(400).json({ ok: false, error: "ID_REQUIRED" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const contact = (await client.query<{
        id: string;
        full_name: string | null;
        email: string | null;
        phone_e164: string | null;
        company_name: string | null;
        promoted_lender_id: string | null;
      }>(
        `SELECT c.id, c.full_name, c.email, c.phone_e164,
                COALESCE(co.legal_name, c.full_name) AS company_name,
                c.promoted_lender_id
           FROM bi_contacts c
           LEFT JOIN bi_companies co ON co.id = c.company_id
          WHERE c.id = $1
          FOR UPDATE OF c`,
        [contactId],
      )).rows[0];

      if (!contact) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "CONTACT_NOT_FOUND" });
      }
      if (contact.promoted_lender_id) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          error: "ALREADY_ONBOARDED",
          lender_id: contact.promoted_lender_id,
        });
      }

      const fullName = contact.full_name?.trim() ?? "";
      const email = contact.email?.trim().toLowerCase() ?? "";
      const phone = contact.phone_e164?.trim() ?? "";
      const companyName = contact.company_name?.trim() || fullName;
      if (!fullName || !email || !phone) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "MISSING_CONTACT_FIELDS" });
      }

      const lender = await client.query<{ id: string }>(
        `INSERT INTO bi_lenders
           (company_name, website_url, address_line1, city, province, postal_code,
            country, contact_full_name, contact_email, contact_phone_e164, is_active)
         VALUES ($1, NULL, NULL, NULL, NULL, NULL, 'CA', $2, $3, $4, TRUE)
         RETURNING id`,
        [companyName, fullName, email, phone],
      );
      const lenderId = lender.rows[0]!.id;

      await client.query(
        `UPDATE bi_contacts
            SET promoted_lender_id = $2,
                outreach_status = 'onboarding',
                outreach_updated_at = NOW()
          WHERE id = $1`,
        [contactId, lenderId],
      );

      await client.query("COMMIT");

      void sendOutreachSms(
        phone,
        `Boreal Risk: ${fullName}, you have been added as a lender. Sign in: https://www.boreal.insure/lender/login. Use this mobile number when prompted. Reply STOP to opt out.`,
      ).catch((err: unknown) => {
        logger.error({ err, to: phone, contactId, lenderId }, "start_onboarding_sms_failed");
      });

      return res.status(201).json({ ok: true, lender_id: lenderId });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error({ err, contactId }, "start_onboarding_failed");
      return res.status(500).json({ ok: false, error: "START_ONBOARDING_FAILED" });
    } finally {
      client.release();
    }
  },
);

export default router;
