// BI_SERVER_BLOCK_v257_STAFF_DIRECTORY_v1
// Staff directory + current-user profile endpoints. Mounted at
// /api/v1/bi/staff. The directory is what the portal calls to translate
// staffUserId UUIDs into human names in the Outreach owner column,
// owner filter dropdown, and Contact/Company detail Owner fields.

import { Router } from "express";
import { pool } from "../db";
import { logger } from "../platform/logger";

const router = Router();

function ok<T>(res: any, data: T) {
  return res.json({ data });
}

function s(v: unknown, max = 200): string | null {
  if (v === null) return null;
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

// GET /directory — list active staff for portal lookups.
// Returns minimum columns needed to render a name + email tooltip:
//   { staff_user_id, full_name, email, role }
// Ordered by full_name (NULLS LAST so unnamed accounts sort to the bottom),
// then by staff_user_id for stability.
router.get("/directory", async (req, res) => {
  const search =
    typeof req.query.q === "string" ? req.query.q.trim() : "";
  const where: string[] = ["is_active = TRUE"];
  const params: unknown[] = [];
  let i = 1;
  if (search) {
    where.push(
      `(full_name ILIKE $${i} OR email ILIKE $${i})`,
    );
    params.push(`%${search}%`);
    i++;
  }
  try {
    const r = await pool.query(
      `SELECT staff_user_id, full_name, email, role
         FROM bi_staff_profile
        WHERE ${where.join(" AND ")}
        ORDER BY full_name ASC NULLS LAST, staff_user_id ASC
        LIMIT 500`,
      params,
    );
    return ok(res, r.rows);
  } catch (err: any) {
    logger.error({ err }, "bi_staff_directory_list_failed");
    return res.status(500).json({ error: "list_failed" });
  }
});

// GET /me — current staff's profile. Returns null when the staff member
// has never registered a profile (the portal will then prompt them to
// fill it in via PUT /me on first BI silo visit).
router.get("/me", async (req, res) => {
  const actor = ((req as any).user ?? {}) as { staffUserId?: string };
  const staffId = typeof actor.staffUserId === "string" ? actor.staffUserId : null;
  if (!staffId) return res.status(400).json({ error: "no_staff_user_id" });

  try {
    const r = await pool.query(
      `SELECT staff_user_id, full_name, email, role, is_active
         FROM bi_staff_profile
        WHERE staff_user_id = $1
        LIMIT 1`,
      [staffId],
    );
    return ok(res, r.rows[0] ?? null);
  } catch (err: any) {
    logger.error({ err, staffId }, "bi_staff_me_get_failed");
    return res.status(500).json({ error: "get_failed" });
  }
});

// PUT /me — upsert current staff's profile. Body: { full_name?, email?, role? }
// staff_user_id is taken from the JWT, never the request body.
// role is treated as opaque text; downstream consumers (Outreach filter)
// don't filter on it yet. is_active defaults TRUE on create.
router.put("/me", async (req, res) => {
  const actor = ((req as any).user ?? {}) as { staffUserId?: string };
  const staffId = typeof actor.staffUserId === "string" ? actor.staffUserId : null;
  if (!staffId) return res.status(400).json({ error: "no_staff_user_id" });

  const b: Record<string, unknown> = (req.body ?? {}) as Record<string, unknown>;
  const fullName = b.full_name === undefined ? undefined : (b.full_name === null ? null : s(b.full_name, 200));
  const email = b.email === undefined ? undefined : (b.email === null ? null : (() => {
    const v = s(b.email, 200);
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "__INVALID__";
    return v ? v.toLowerCase() : null;
  })());
  if (email === "__INVALID__") {
    return res.status(400).json({ error: "invalid_email" });
  }
  const role = b.role === undefined ? undefined : (b.role === null ? null : s(b.role, 50));

  try {
    // First, INSERT-or-no-op so the row exists.
    await pool.query(
      `INSERT INTO bi_staff_profile (staff_user_id, full_name, email, role)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (staff_user_id) DO NOTHING`,
      [staffId, fullName ?? null, email ?? null, role ?? null],
    );

    // Then, build a partial UPDATE for whichever fields the caller sent.
    // This keeps the upsert "PATCH-like" — undefined leaves alone, null clears.
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (fullName !== undefined) {
      sets.push(`full_name = $${i++}`);
      params.push(fullName);
    }
    if (email !== undefined) {
      sets.push(`email = $${i++}`);
      params.push(email);
    }
    if (role !== undefined) {
      sets.push(`role = $${i++}`);
      params.push(role);
    }
    if (sets.length > 0) {
      sets.push(`updated_at = NOW()`);
      params.push(staffId);
      await pool.query(
        `UPDATE bi_staff_profile SET ${sets.join(", ")}
          WHERE staff_user_id = $${i}`,
        params,
      );
    }

    const r = await pool.query(
      `SELECT staff_user_id, full_name, email, role, is_active
         FROM bi_staff_profile
        WHERE staff_user_id = $1
        LIMIT 1`,
      [staffId],
    );
    return ok(res, r.rows[0] ?? null);
  } catch (err: any) {
    logger.error({ err, staffId }, "bi_staff_me_put_failed");
    return res.status(500).json({ error: "put_failed" });
  }
});

export default router;
