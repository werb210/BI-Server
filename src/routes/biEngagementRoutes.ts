// BI_SERVER_ENGAGEMENT_v1 - staff API for PGI outreach tracking (Insurance > Marketing > Outreach). Mounted at /api/v1/bi
// behind requireAuth.
//   GET  /engagement/board?flow=&owner=&q=     stages with counts and the newest cards
//   GET  /engagement/queue?owner=              who needs a follow-up, oldest due first
//   GET  /engagement/funnel?days=              sent -> signed up, per flow, reply kinds and leaks
//   GET  /engagement/contacts/:id              one contact's row and its history
//   POST /engagement/contacts/:id/action       { action: followed_up | met | no_show | booked | lost | reopen | signed_up | reply_kind, kind?, reason?, start? }
//   POST /engagement/contacts/:id/owner        { user_id, name }
//   GET  /engagement/settings | PUT (Admin)    { followers: [{ id, name }], digest }
import express, { type Request, type Response } from "express";
import { pool } from "../db";
import { logger } from "../platform/logger";
import {
  STAGES, STAGE_LABEL, board, contactDetail, funnel, getSettings, queue, recordEvent, saveSettings, type EventKind,
} from "../services/engagement/engagement";
import { REPLY_KIND_LABEL } from "../services/engagement/classifyReply";

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isAdmin = (req: Request) => ["admin", "owner"].includes(String((req as any).user?.role ?? "").toLowerCase());
const actor = (req: Request) => String((req as any).user?.name ?? (req as any).user?.email ?? "Staff");
const s = (v: unknown, max = 200) => { const t = String(v ?? "").trim().slice(0, max); return t || null; };
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch((err) => {
    logger.error({ err: (err as Error)?.message, path: req.path }, "bi.engagement.failed");
    if (!res.headersSent) res.status(500).json({ ok: false, error: "internal_error" });
  });
};
const filters = (req: Request) => ({
  flowId: UUID.test(String(req.query.flow ?? "")) ? String(req.query.flow) : null,
  owner: s(req.query.owner, 80),
  q: s(req.query.q, 100),
});

router.get("/engagement/meta", (_req, res) => {
  res.json({ ok: true, brand: "PGI", stages: [...STAGES, "lost"].map((k) => ({ key: k, label: STAGE_LABEL[k as keyof typeof STAGE_LABEL] })), replyKinds: REPLY_KIND_LABEL });
});
router.get("/engagement/board", wrap(async (req, res) => res.json({ ok: true, stages: await board(pool, filters(req)) })));
router.get("/engagement/queue", wrap(async (req, res) => res.json({ ok: true, items: await queue(pool, filters(req)) })));
router.get("/engagement/funnel", wrap(async (req, res) => {
  const days = Number(req.query.days);
  const since = Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 86_400_000) : null;
  res.json({ ok: true, ...(await funnel(pool, since)) });
}));
router.get("/engagement/contacts/:id", wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  const d = await contactDetail(pool, req.params.id);
  if (!d) return res.status(404).json({ ok: false, error: "not_found" });
  res.json({ ok: true, contact: d });
}));
const ACTIONS: EventKind[] = ["followed_up", "met", "no_show", "booked", "lost", "reopen", "signed_up", "reply_kind"];
router.post("/engagement/contacts/:id/action", wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  const action = String(req.body?.action ?? "") as EventKind;
  if (!ACTIONS.includes(action)) return res.status(400).json({ ok: false, error: "bad_action" });
  if (action === "reply_kind" && !(String(req.body?.kind ?? "") in REPLY_KIND_LABEL)) return res.status(400).json({ ok: false, error: "bad_kind" });
  const start = req.body?.start ? new Date(String(req.body.start)) : null;
  const ok = await recordEvent(pool, {
    contactId: req.params.id, kind: action, actor: actor(req),
    detail: { kind: s(req.body?.kind, 40), reason: s(req.body?.reason, 200), start: start && !Number.isNaN(start.getTime()) ? start.toISOString() : null, note: s(req.body?.note, 500) },
  });
  if (!ok) return res.status(404).json({ ok: false, error: "not_tracked", message: "This contact is not in PGI outreach." });
  res.json({ ok: true, contact: await contactDetail(pool, req.params.id) });
}));
router.post("/engagement/contacts/:id/owner", wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  const r = await pool.query(`UPDATE bi_engagement SET owner_user_id = $2, owner_name = $3, updated_at = now() WHERE contact_id = $1`,
    [req.params.id, s(req.body?.user_id, 80), s(req.body?.name, 120)]);
  if (!r.rowCount) return res.status(404).json({ ok: false, error: "not_tracked" });
  res.json({ ok: true });
}));
router.get("/engagement/settings", wrap(async (_req, res) => res.json({ ok: true, settings: await getSettings(pool) })));
router.put("/engagement/settings", wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "admin_only" });
  const followers = Array.isArray(req.body?.followers)
    ? req.body.followers.map((f: any) => ({ id: s(f?.id, 80), name: s(f?.name, 120) ?? "" })).filter((f: any) => f.id).slice(0, 20)
    : undefined;
  await saveSettings(pool, { followers, digest: typeof req.body?.digest === "boolean" ? req.body.digest : undefined });
  res.json({ ok: true, settings: await getSettings(pool) });
}));

export default router;
