// BI_V1_FINAL_v47 — application-scoped notes for the BI silo.
// Mounted at /api/v1/bi/applications/:id/notes.
import { Router } from "express";
import { pool } from "../db";
import { badRequest, ok } from "../utils/apiResponse";
import { parseAndResolveMentions } from "../services/notes/biMentions";

const router = Router({ mergeParams: true });

const SHAPE = `id, application_id, body, owner_user_id, mentions, created_at, updated_at`;

router.get("/", async (req, res) => {
  const appId = String((req.params as { id?: string }).id ?? "").trim();
  if (!appId) return badRequest(res, "application id required");
  const r = await pool.query(
    `SELECT ${SHAPE} FROM bi_notes WHERE application_id=$1 AND is_deleted=false ORDER BY created_at DESC LIMIT 200`,
    [appId]
  );
  return ok(res, { ok: true, items: r.rows });
});

router.post("/", async (req, res) => {
  const appId = String((req.params as { id?: string }).id ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!appId) return badRequest(res, "application id required");
  if (!body) return badRequest(res, "body required");
  const userId = (req.user as { staffUserId?: string } | undefined)?.staffUserId ?? null;
  const mentions = await parseAndResolveMentions(body);
  const r = await pool.query(
    `INSERT INTO bi_notes (application_id, body, owner_user_id, mentions)
     VALUES ($1,$2,$3,$4) RETURNING ${SHAPE}`,
    [appId, body, userId, mentions]
  );
  return res.status(201).json({ ok: true, data: r.rows[0] });
});

router.patch("/:noteId", async (req, res) => {
  const noteId = String(req.params.noteId ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!noteId) return badRequest(res, "noteId required");
  if (!body) return badRequest(res, "body required");
  const mentions = await parseAndResolveMentions(body);
  const r = await pool.query(
    `UPDATE bi_notes SET body=$1, mentions=$2, updated_at=NOW()
      WHERE id=$3 AND is_deleted=false RETURNING ${SHAPE}`,
    [body, mentions, noteId]
  );
  if (!r.rows[0]) return res.status(404).json({ error: "Note not found" });
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
