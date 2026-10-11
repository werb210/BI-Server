// BI_V1_FINAL_v47 - application-scoped notes for the BI silo.
// Mounted at /api/v1/bi/applications/:id/notes (behind requireAuth).
//
// BI_SERVER_v789_APPLICATION_NOTES [91] - notes live in bi_application_notes
// (the v789 migration copied the non-deleted bi_notes rows in, keeping their
// ids). Staff only: service tokens get 403.
//   GET  -> { status: "ok", ok: true, notes: [{ id, body, author_name, created_at }], data: { ok, notes } }
//           newest first. `data` keeps the pre-v789 envelope readers working.
//   POST { body } (1-8000 chars after trim) -> 201 with the note object itself
//           ({ id, body, author_name, created_at }).
//   404 when the application does not exist, 400 on a non-uuid id.
// The legacy PATCH/DELETE handlers on bi_notes were removed: they edited the
// old bi_notes copy, which no read path shows any more, so an edit "succeeded"
// without changing the visible note.
import { Router, type Request, type Response } from "express";
import { pool } from "../db";
import { logHiddenError } from "../platform/safeError";
import { requireStaffUser } from "../middleware/requireStaffUser";

const router = Router({ mergeParams: true });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 8000;

// This router is mounted on its own path, so a router-level guard only
// affects the notes routes.
router.use(requireStaffUser);

function appIdFrom(req: Request): string | null {
  const id = String((req.params as { id?: string }).id ?? "").trim();
  return UUID_RE.test(id) ? id : null;
}

function claimString(u: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = u?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

router.get("/", async (req: Request, res: Response) => {
  const appId = appIdFrom(req);
  if (!appId) return res.status(400).json({ status: "error", error: "invalid_application_id" });
  try {
    const app = await pool.query(`SELECT 1 FROM bi_applications WHERE id = $1 LIMIT 1`, [appId]);
    if (!app.rows[0]) return res.status(404).json({ status: "error", error: "application_not_found" });
    const r = await pool.query(
      `SELECT id, body, author_name, created_at
         FROM bi_application_notes
        WHERE application_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 500`,
      [appId],
    );
    return res.json({ status: "ok", ok: true, notes: r.rows, data: { ok: true, notes: r.rows } });
  } catch (err) {
    return res.status(500).json({ status: "error", error: "notes_list_failed", requestId: logHiddenError(req, err, "notes_list_failed") });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const appId = appIdFrom(req);
  if (!appId) return res.status(400).json({ status: "error", error: "invalid_application_id" });
  const raw = (req.body as { body?: unknown } | undefined)?.body;
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) return res.status(400).json({ status: "error", error: "body_required" });
  if (body.length > MAX_BODY) return res.status(400).json({ status: "error", error: "body_too_long" });

  const u = (req as unknown as { user?: Record<string, unknown> }).user;
  const authorId = claimString(u, "staffUserId", "sub");
  const claimName = claimString(u, "full_name", "name", "displayName", "email");
  try {
    // One statement: the application must exist (else no row -> 404) and the
    // author name comes from bi_staff_profile, falling back to the token claims.
    const r = await pool.query(
      `INSERT INTO bi_application_notes (application_id, author_id, author_name, body)
       SELECT a.id,
              $2::text,
              COALESCE(
                NULLIF((SELECT sp.full_name FROM bi_staff_profile sp WHERE sp.staff_user_id = $2::text LIMIT 1), ''),
                $3::text
              ),
              $4
         FROM bi_applications a
        WHERE a.id = $1
       RETURNING id, body, author_name, created_at`,
      [appId, authorId, claimName, body],
    );
    if (!r.rows[0]) return res.status(404).json({ status: "error", error: "application_not_found" });
    return res.status(201).json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ status: "error", error: "note_create_failed", requestId: logHiddenError(req, err, "note_create_failed") });
  }
});

export default router;
