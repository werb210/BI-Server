// BI_V1_FINAL_v47 — application-scoped notes for the BI silo.
// Mounted at /api/v1/bi/applications/:id/notes.
import { Router } from "express";
import { pool } from "../db";
import { badRequest, ok } from "../utils/apiResponse";
import { parseAndResolveMentions } from "../services/notes/biMentions";

const router = Router({ mergeParams: true });

// BI_SERVER_BLOCK_v272_NOTES_AUTHOR_NAME_JOIN_v1 — column list + JOIN.
// bi_notes.owner_user_id is the staff JWT's staffUserId; bi_staff_profile
// (v251 + v257) maps that to a human name. Portal NotesTab expects
// n.author_name; without this join it rendered empty.
const NOTE_SHAPE_QUALIFIED = `n.id, n.application_id, n.body, n.owner_user_id, n.mentions, n.created_at, n.updated_at, sp.full_name AS author_name`;
const NOTE_FROM_JOIN = `bi_notes n LEFT JOIN bi_staff_profile sp ON sp.staff_user_id = n.owner_user_id`;

// BI_SERVER_BLOCK_v261_CARRIER_PATH_E2E_FIX_v2 / v272
// Portal NotesTab reads r.notes; previous handler returned `items`
// → setNotes(undefined) → tab crashed on .map.
router.get("/", async (req, res) => {
  const appId = String((req.params as { id?: string }).id ?? "").trim();
  if (!appId) return badRequest(res, "application id required");
  const r = await pool.query(
    `SELECT ${NOTE_SHAPE_QUALIFIED} FROM ${NOTE_FROM_JOIN} WHERE n.application_id=$1 AND n.is_deleted=false ORDER BY n.created_at DESC LIMIT 200`,
    [appId]
  );
  return ok(res, { ok: true, notes: r.rows });
});

router.post("/", async (req, res) => {
  const appId = String((req.params as { id?: string }).id ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!appId) return badRequest(res, "application id required");
  if (!body) return badRequest(res, "body required");
  const userId = (req.user as { staffUserId?: string } | undefined)?.staffUserId ?? null;
  const mentions = await parseAndResolveMentions(body);
  // Insert first, then SELECT with the join so the response carries
  // author_name. Two-statement pattern is required because RETURNING
  // can't reference joined tables.
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO bi_notes (application_id, body, owner_user_id, mentions)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [appId, body, userId, mentions]
  );
  const r = await pool.query(
    `SELECT ${NOTE_SHAPE_QUALIFIED} FROM ${NOTE_FROM_JOIN} WHERE n.id=$1 LIMIT 1`,
    [ins.rows[0]!.id]
  );
  return res.status(201).json({ ok: true, data: r.rows[0] });
});

router.patch("/:noteId", async (req, res) => {
  const noteId = String(req.params.noteId ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!noteId) return badRequest(res, "noteId required");
  if (!body) return badRequest(res, "body required");
  const mentions = await parseAndResolveMentions(body);
  const upd = await pool.query<{ id: string }>(
    `UPDATE bi_notes SET body=$1, mentions=$2, updated_at=NOW()
      WHERE id=$3 AND is_deleted=false RETURNING id`,
    [body, mentions, noteId]
  );
  if (!upd.rows[0]) return res.status(404).json({ error: "Note not found" });
  const r = await pool.query(
    `SELECT ${NOTE_SHAPE_QUALIFIED} FROM ${NOTE_FROM_JOIN} WHERE n.id=$1 LIMIT 1`,
    [upd.rows[0].id]
  );
  return ok(res, { ok: true, data: r.rows[0] });
});

router.delete("/:noteId", async (req, res) => {
  const noteId = String(req.params.noteId ?? "").trim();
  if (!noteId) return badRequest(res, "noteId required");
  const r = await pool.query(
    `UPDATE bi_notes SET is_deleted=true, updated_at=NOW() WHERE id=$1 AND is_deleted=false RETURNING id`,
    [noteId]
  );
  if (!r.rows[0]) return res.status(404).json({ error: "Note not found" });
  return ok(res, { ok: true, id: noteId });
});

export default router;
