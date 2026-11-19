// BI_SERVER_EMAIL_FLOWS_v1 - staff API for email flows (Insurance > Marketing > Flows). Mounted at /api/v1/bi behind requireAuth.
//   GET    /flows                       every flow with its numbers
//   GET    /flows/presets               the ready-made flows that can be created
//   POST   /flows                       { preset, owner_user_id?, owner_name?, from_name?, reply_to?, daily_new? } -> a draft
//   GET    /flows/:id                   one flow with its seven emails
//   PATCH  /flows/:id                   change settings or wording
//   POST   /flows/:id/audience          add everyone who matches (again later to pick up new contacts)
//   POST   /flows/:id/test              { to } send all seven emails to one address, marked TEST
//   POST   /flows/:id/start | /pause
// Only an Admin can create, change, start or pause a flow.
import express, { type Request, type Response } from "express";
import { pool } from "../db";
import { logger } from "../platform/logger";
import { mergeFields, sendBiMarketingEmail } from "../services/biSendgridService";
import { FLOW_KEYS, FLOW_KEY_LABEL, dailyNewCap, htmlToText, isFlowKey, withFooter } from "../services/flows/flowEngine";
import { FLOW_PRESETS, presetByKey } from "../services/flows/flowPresets";

const router = express.Router();
const isAdmin = (req: Request) => ["admin", "owner"].includes(String((req as any).user?.role ?? "").toLowerCase());
const adminOnly = (req: Request, res: Response): boolean => {
  if (isAdmin(req)) return true;
  res.status(403).json({ ok: false, error: "admin_only", message: "Only an Admin can change email flows." });
  return false;
};
const text = (v: unknown, max = 200): string | null => { const t = String(v ?? "").trim().slice(0, max); return t || null; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  fn(req, res).catch((err) => {
    logger.error({ err: (err as Error)?.message, path: req.path }, "bi.flows.failed");
    if (!res.headersSent) res.status(500).json({ ok: false, error: "internal_error" });
  });
};

const US_SQL = `(lower(btrim(coalesce(c.country, ''))) IN ('us', 'usa', 'united states', 'united states of america')
  OR EXISTS (SELECT 1 FROM unnest(coalesce(c.tags, '{}')) t WHERE lower(btrim(t)) LIKE 'us %'))`;
/** Who a flow is for: people tagged lender / broker, in the flow's country, with an email we may still write to. */
export function audienceSql(market: string): string {
  const marketSql = market === "US" ? `AND ${US_SQL}` : market === "CA" ? `AND NOT ${US_SQL}` : "";
  return `
    FROM bi_contacts c
   WHERE c.email IS NOT NULL AND position('@' in c.email) > 1
     AND COALESCE(c.outreach_excluded, false) = false
     AND EXISTS (SELECT 1 FROM unnest(coalesce(c.tags, '{}')) t WHERE lower(btrim(t)) LIKE $1 || '%')
     ${marketSql}
     AND NOT EXISTS (SELECT 1 FROM bi_suppressions s
                      WHERE (lower(s.email) = lower(c.email) OR lower(s.identifier) = lower(c.email) OR s.contact_id = c.id) AND s.channel IN ('email', 'all'))`;
}

const COUNTS_SQL = `
  SELECT f.id, f.name, f.preset, f.audience, f.market, f.status, f.daily_new, f.from_name, f.reply_to, f.owner_user_id, f.owner_name,
         f.link_url, f.booking_url, f.started_at, f.created_at,
         count(m.id)::int AS people,
         count(m.id) FILTER (WHERE m.status = 'queued')::int AS waiting,
         count(m.id) FILTER (WHERE m.first_sent_at IS NOT NULL)::int AS emailed,
         count(m.id) FILTER (WHERE m.track = 'none' AND m.first_sent_at IS NOT NULL)::int AS not_opened,
         count(m.id) FILTER (WHERE m.track = 'opened')::int AS opened,
         count(m.id) FILTER (WHERE m.track = 'clicked')::int AS clicked,
         count(m.id) FILTER (WHERE m.status = 'stopped')::int AS stopped,
         COALESCE(sum(cardinality(m.sent_keys)), 0)::int AS emails_sent
    FROM bi_flows f LEFT JOIN bi_flow_members m ON m.flow_id = f.id
   WHERE f.status <> 'archived'`;

router.get("/flows/presets", wrap(async (_req, res) => {
  res.json({ ok: true, presets: FLOW_PRESETS.map((p) => ({ key: p.key, name: p.name, audience: p.audience, market: p.market })) });
}));

router.get("/flows", wrap(async (_req, res) => {
  const r = await pool.query(`${COUNTS_SQL} GROUP BY f.id ORDER BY f.created_at`);
  const now = new Date();
  res.json({ ok: true, flows: r.rows.map((f) => ({ ...f, new_today_limit: dailyNewCap(f.daily_new, f.started_at ? new Date(f.started_at) : null, now) })) });
}));

router.post("/flows", wrap(async (req, res) => {
  if (!adminOnly(req, res)) return;
  const preset = presetByKey(req.body?.preset);
  if (!preset) return res.status(400).json({ ok: false, error: "unknown_preset", message: "Pick one of the ready-made flows." });
  const exists = await pool.query(`SELECT id FROM bi_flows WHERE preset = $1 AND status <> 'archived' LIMIT 1`, [preset.key]);
  if (exists.rowCount) return res.status(409).json({ ok: false, error: "already_exists", message: "That flow already exists.", id: exists.rows[0].id });
  const daily = Math.max(1, Math.min(1000, Math.trunc(Number(req.body?.daily_new) || 100)));
  const r = await pool.query(
    `INSERT INTO bi_flows (name, preset, audience, market, daily_new, from_name, reply_to, owner_user_id, owner_name, link_url, booking_url, emails, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) RETURNING id`,
    [preset.name, preset.key, preset.audience, preset.market, daily, text(req.body?.from_name) ?? "Andrew at Boreal Risk Management", text(req.body?.reply_to, 200),
      text(req.body?.owner_user_id, 80), text(req.body?.owner_name, 120), preset.link_url, preset.booking_url, JSON.stringify(preset.emails),
      String((req as any).user?.userId ?? (req as any).user?.id ?? "") || null],
  );
  res.status(201).json({ ok: true, id: r.rows[0].id });
}));

router.get("/flows/:id", wrap(async (req, res) => {
  if (!UUID.test(String(req.params.id))) return res.status(404).json({ ok: false, error: "not_found" });
  const r = await pool.query(`${COUNTS_SQL} AND f.id = $1 GROUP BY f.id`, [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ ok: false, error: "not_found" });
  const e = await pool.query(`SELECT emails FROM bi_flows WHERE id = $1`, [req.params.id]);
  const emails = e.rows[0]?.emails ?? {};
  const waiting = await pool.query(`SELECT count(*)::int AS n ${audienceSql(r.rows[0].market)} AND NOT EXISTS (SELECT 1 FROM bi_flow_members m WHERE m.flow_id = $2 AND m.contact_id = c.id)`, [r.rows[0].audience, req.params.id]);
  res.json({ ok: true, flow: r.rows[0], not_yet_added: waiting.rows[0]?.n ?? 0,
    emails: FLOW_KEYS.map((key) => ({ key, label: FLOW_KEY_LABEL[key], subject: emails[key]?.subject ?? "", body: emails[key]?.body ?? "" })) });
}));

router.patch("/flows/:id", wrap(async (req, res) => {
  if (!adminOnly(req, res)) return;
  if (!UUID.test(String(req.params.id))) return res.status(404).json({ ok: false, error: "not_found" });
  const cur = await pool.query(`SELECT emails FROM bi_flows WHERE id = $1 AND status <> 'archived'`, [req.params.id]);
  if (!cur.rowCount) return res.status(404).json({ ok: false, error: "not_found" });
  const b = req.body ?? {};
  const emails = { ...(cur.rows[0].emails ?? {}) } as Record<string, { subject: string; body: string }>;
  if (b.emails && typeof b.emails === "object") {
    for (const [key, v] of Object.entries(b.emails as Record<string, any>)) {
      if (!isFlowKey(key)) continue;
      const subject = String(v?.subject ?? "").trim().slice(0, 200);
      const body = String(v?.body ?? "").trim().slice(0, 20_000);
      if (!subject || !body) return res.status(400).json({ ok: false, error: "empty_email", message: `${FLOW_KEY_LABEL[key]} needs a subject and a message.` });
      emails[key] = { subject, body };
    }
  }
  const daily = b.daily_new === undefined ? null : Math.max(1, Math.min(1000, Math.trunc(Number(b.daily_new) || 100)));
  await pool.query(
    `UPDATE bi_flows SET emails = $2::jsonb, daily_new = COALESCE($3, daily_new),
            from_name = COALESCE($4, from_name), reply_to = CASE WHEN $5::boolean THEN $6 ELSE reply_to END,
            owner_user_id = CASE WHEN $7::boolean THEN $8 ELSE owner_user_id END, owner_name = CASE WHEN $7::boolean THEN $9 ELSE owner_name END,
            link_url = COALESCE($10, link_url), booking_url = COALESCE($11, booking_url), updated_at = now()
      WHERE id = $1`,
    [req.params.id, JSON.stringify(emails), daily, text(b.from_name), b.reply_to !== undefined, text(b.reply_to), b.owner_user_id !== undefined,
      text(b.owner_user_id, 80), text(b.owner_name, 120), text(b.link_url, 500), text(b.booking_url, 500)],
  );
  res.json({ ok: true });
}));

// BI_SERVER_PGI_COMPLIANCE_v1 - put a flow's emails and link back to its ready-made wording (used to reissue the
// four flows after PGI Canada Ltd.'s notice of 2026-11-19). Admins only; the flow's status is not changed.
router.post("/flows/:id/reset-copy", wrap(async (req, res) => {
  if (!adminOnly(req, res)) return;
  if (!UUID.test(String(req.params.id))) return res.status(404).json({ ok: false, error: "not_found" });
  const cur = await pool.query(`SELECT preset FROM bi_flows WHERE id = $1 AND status <> 'archived'`, [req.params.id]);
  if (!cur.rowCount) return res.status(404).json({ ok: false, error: "not_found" });
  const preset = presetByKey(cur.rows[0].preset);
  if (!preset) return res.status(400).json({ ok: false, error: "no_preset", message: "This flow was not made from a ready-made flow." });
  await pool.query(`UPDATE bi_flows SET emails = $2::jsonb, link_url = $3, updated_at = now() WHERE id = $1`, [req.params.id, JSON.stringify(preset.emails), preset.link_url]);
  res.json({ ok: true });
}));

router.post("/flows/:id/audience", wrap(async (req, res) => {
  if (!adminOnly(req, res)) return;
  if (!UUID.test(String(req.params.id))) return res.status(404).json({ ok: false, error: "not_found" });
  const f = await pool.query(`SELECT audience, market FROM bi_flows WHERE id = $1 AND status <> 'archived'`, [req.params.id]);
  if (!f.rowCount) return res.status(404).json({ ok: false, error: "not_found" });
  const r = await pool.query(
    `INSERT INTO bi_flow_members (flow_id, contact_id, email)
     SELECT DISTINCT ON (lower(c.email)) $2::uuid, c.id, lower(btrim(c.email)) ${audienceSql(f.rows[0].market)}
        AND NOT EXISTS (SELECT 1 FROM bi_flow_members m WHERE m.flow_id = $2 AND lower(m.email) = lower(btrim(c.email)))
      ORDER BY lower(c.email), c.created_at
     ON CONFLICT (flow_id, contact_id) DO NOTHING`,
    [f.rows[0].audience, req.params.id],
  );
  res.json({ ok: true, added: r.rowCount ?? 0 });
}));

router.post("/flows/:id/test", wrap(async (req, res) => {
  if (!adminOnly(req, res)) return;
  const to = String(req.body?.to ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ ok: false, error: "bad_email", message: "Enter the email address to send the test to." });
  if (!UUID.test(String(req.params.id))) return res.status(404).json({ ok: false, error: "not_found" });
  const f = await pool.query(`SELECT * FROM bi_flows WHERE id = $1`, [req.params.id]);
  if (!f.rowCount) return res.status(404).json({ ok: false, error: "not_found" });
  const flow = f.rows[0];
  const merge = { first_name: "Sample", full_name: "Sample Person", name: "Sample Person", company: "Sample Company", link: flow.link_url ?? "", booking_link: flow.booking_url ?? "", email: to };
  let sent = 0;
  for (const key of FLOW_KEYS) {
    const e = (flow.emails ?? {})[key];
    if (!e?.subject || !e?.body) continue;
    const html = withFooter(mergeFields(String(e.body), merge), flow.from_name ?? "Boreal Risk Management");
    await sendBiMarketingEmail({ to, subject: `[TEST ${sent + 1}/7 - ${FLOW_KEY_LABEL[key]}] ${mergeFields(String(e.subject), merge)}`, html, text: htmlToText(html),
      fromName: flow.from_name ?? undefined, replyTo: flow.reply_to ?? undefined });
    sent += 1;
  }
  res.json({ ok: true, sent });
}));

for (const [action, status] of [["start", "active"], ["pause", "paused"]] as const) {
  router.post(`/flows/:id/${action}`, wrap(async (req, res) => {
    if (!adminOnly(req, res)) return;
    if (!UUID.test(String(req.params.id))) return res.status(404).json({ ok: false, error: "not_found" });
    if (action === "start") {
      const people = await pool.query(`SELECT count(*)::int AS n FROM bi_flow_members WHERE flow_id = $1`, [req.params.id]);
      if (!Number(people.rows[0]?.n)) return res.status(400).json({ ok: false, error: "no_people", message: "Add the people first." });
    }
    const r = await pool.query(
      `UPDATE bi_flows SET status = $2, started_at = CASE WHEN $2 = 'active' THEN COALESCE(started_at, now()) ELSE started_at END, updated_at = now()
        WHERE id = $1 AND status <> 'archived' RETURNING id`,
      [req.params.id, status],
    );
    if (!r.rowCount) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, status });
  }));
}

export default router;
