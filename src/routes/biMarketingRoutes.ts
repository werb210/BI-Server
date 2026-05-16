// BI_SERVER_BLOCK_BI_ROUND8_MARKETING_v1
// Marketing module endpoints. Mounted under /api/v1/bi/marketing
// from server.ts. All require authenticated staff.
import { Router, Request, Response } from "express";
import { pool } from "../db";
import { logger } from "../platform/logger";

const router: Router = Router();

function badRequest(res: Response, message: string) {
  return res.status(400).json({ error: { code: "bad_request", message } });
}

// ----- Sequences -----------------------------------------------------

router.get("/sequences", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.id, s.name, s.description, s.status, s.created_at, s.updated_at,
              (SELECT COUNT(*)::int FROM bi_sequence_steps st WHERE st.sequence_id = s.id) AS step_count,
              (SELECT COUNT(*)::int FROM bi_sequence_enrollments e WHERE e.sequence_id = s.id AND e.status = 'active') AS active_enrollments
         FROM bi_sequences s
        WHERE s.deleted_at IS NULL
        ORDER BY s.updated_at DESC`,
    );
    return res.json({ sequences: r.rows });
  } catch (err) {
    logger.error({ err }, "bi.marketing.sequences.list.failed");
    return res.status(500).json({ error: { code: "internal", message: "List failed" } });
  }
});

router.post("/sequences", async (req: Request, res) => {
  const b = (req.body || {}) as any;
  if (!b.name || typeof b.name !== "string") return badRequest(res, "name required");
  const steps = Array.isArray(b.steps) ? b.steps : [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sr = await client.query(
      `INSERT INTO bi_sequences (name, description, status, send_rate_cap,
                                 send_hours_local_start, send_hours_local_end,
                                 send_weekdays_only, ab_enabled, sender_rotation,
                                 pause_on_reply, pause_on_bounce, created_by)
            VALUES ($1, $2, COALESCE($3,'draft'), COALESCE($4,100),
                    COALESCE($5,9), COALESCE($6,17),
                    COALESCE($7,TRUE), COALESCE($8,FALSE), COALESCE($9,ARRAY[]::TEXT[]),
                    COALESCE($10,TRUE), COALESCE($11,TRUE), $12)
            RETURNING *`,
      [
        b.name, b.description ?? null, b.status ?? null, b.send_rate_cap ?? null,
        b.send_hours_local_start ?? null, b.send_hours_local_end ?? null,
        b.send_weekdays_only ?? null, b.ab_enabled ?? null, b.sender_rotation ?? null,
        b.pause_on_reply ?? null, b.pause_on_bounce ?? null,
        (req as any).user?.id ?? null,
      ],
    );
    const seq = sr.rows[0];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s?.type || !["sms","email","task","wait"].includes(s.type)) {
        await client.query("ROLLBACK");
        return badRequest(res, `step ${i}: invalid type`);
      }
      await client.query(
        `INSERT INTO bi_sequence_steps (sequence_id, position, type, delay_seconds, subject, body, variant, conditions)
              VALUES ($1, $2, $3, COALESCE($4,0), $5, $6, COALESCE($7,'A'), COALESCE($8,'{}'::jsonb))`,
        [seq.id, i, s.type, s.delay_seconds, s.subject ?? null, s.body ?? null, s.variant ?? null, JSON.stringify(s.conditions ?? {})],
      );
    }
    await client.query("COMMIT");
    return res.status(201).json({ sequence: seq });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "bi.marketing.sequences.create.failed");
    return res.status(500).json({ error: { code: "internal", message: "Create failed" } });
  } finally {
    client.release();
  }
});

router.get("/sequences/:id", async (req, res) => {
  try {
    const sr = await pool.query(`SELECT * FROM bi_sequences WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (sr.rowCount === 0) return res.status(404).json({ error: { code: "not_found" } });
    const st = await pool.query(`SELECT * FROM bi_sequence_steps WHERE sequence_id = $1 ORDER BY position, variant`, [req.params.id]);
    return res.json({ sequence: sr.rows[0], steps: st.rows });
  } catch (err) {
    logger.error({ err }, "bi.marketing.sequences.get.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.patch("/sequences/:id", async (req, res) => {
  const b = (req.body || {}) as any;
  const allowed = ["name","description","status","send_rate_cap","send_hours_local_start",
    "send_hours_local_end","send_weekdays_only","ab_enabled","sender_rotation",
    "pause_on_reply","pause_on_bounce"];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of allowed) {
    if (key in b) {
      vals.push(b[key]);
      sets.push(`${key} = $${vals.length}`);
    }
  }
  if (sets.length === 0) return badRequest(res, "no updatable fields");
  vals.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE bi_sequences SET ${sets.join(", ")}, updated_at = NOW()
         WHERE id = $${vals.length} AND deleted_at IS NULL
         RETURNING *`,
      vals,
    );
    if (r.rowCount === 0) return res.status(404).json({ error: { code: "not_found" } });
    return res.json({ sequence: r.rows[0] });
  } catch (err) {
    logger.error({ err }, "bi.marketing.sequences.patch.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.delete("/sequences/:id", async (req, res) => {
  try {
    await pool.query(`UPDATE bi_sequences SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
    await pool.query(`UPDATE bi_sequence_enrollments SET status = 'stopped' WHERE sequence_id = $1 AND status IN ('active','paused')`, [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "bi.marketing.sequences.delete.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.post("/sequences/:id/start", async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE bi_sequences SET status = 'active', updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [req.params.id],
    );
    if (r.rowCount === 0) return res.status(404).json({ error: { code: "not_found" } });
    // Make existing paused enrollments active again, with next_step_at NOW
    await pool.query(
      `UPDATE bi_sequence_enrollments
          SET status = 'active', paused_reason = NULL,
              next_step_at = COALESCE(next_step_at, NOW())
        WHERE sequence_id = $1 AND status = 'paused'`,
      [req.params.id],
    );
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "bi.marketing.sequences.start.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.post("/sequences/:id/pause", async (req, res) => {
  try {
    await pool.query(`UPDATE bi_sequences SET status = 'paused', updated_at = NOW() WHERE id = $1`, [req.params.id]);
    await pool.query(
      `UPDATE bi_sequence_enrollments SET status = 'paused', paused_reason = 'manual'
         WHERE sequence_id = $1 AND status = 'active'`,
      [req.params.id],
    );
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "bi.marketing.sequences.pause.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.post("/sequences/:id/enroll", async (req, res) => {
  const b = (req.body || {}) as any;
  const ids: string[] = Array.isArray(b.contact_ids) ? b.contact_ids : [];
  if (ids.length === 0) return badRequest(res, "contact_ids required (array)");
  try {
    let inserted = 0;
    let skipped = 0;
    for (const cid of ids) {
      const r = await pool.query(
        `INSERT INTO bi_sequence_enrollments (sequence_id, contact_id, status, current_step, next_step_at)
              VALUES ($1, $2, 'active', 0, NOW())
              ON CONFLICT (sequence_id, contact_id) DO NOTHING
              RETURNING id`,
        [req.params.id, cid],
      );
      if (r.rowCount && r.rowCount > 0) inserted++;
      else skipped++;
    }
    return res.json({ inserted, skipped });
  } catch (err) {
    logger.error({ err }, "bi.marketing.sequences.enroll.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.get("/enrollments", async (req, res) => {
  const seqId = (req.query.sequence_id as string) || null;
  const status = (req.query.status as string) || null;
  const limit = Math.min(parseInt(String(req.query.limit || "100")) || 100, 500);
  try {
    const r = await pool.query(
      `SELECT e.*, s.name AS sequence_name, c.full_name AS contact_name, c.email AS contact_email
         FROM bi_sequence_enrollments e
         JOIN bi_sequences s ON s.id = e.sequence_id
         JOIN bi_contacts  c ON c.id = e.contact_id
        WHERE ($1::uuid IS NULL OR e.sequence_id = $1::uuid)
          AND ($2::text IS NULL OR e.status = $2)
        ORDER BY e.started_at DESC
        LIMIT $3`,
      [seqId, status, limit],
    );
    return res.json({ enrollments: r.rows });
  } catch (err) {
    logger.error({ err }, "bi.marketing.enrollments.list.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.patch("/enrollments/:id", async (req, res) => {
  const b = (req.body || {}) as any;
  const status = b.status as string | undefined;
  if (!status || !["active","paused","stopped"].includes(status)) return badRequest(res, "status must be active|paused|stopped");
  try {
    const r = await pool.query(
      `UPDATE bi_sequence_enrollments
          SET status = $2,
              paused_reason = CASE WHEN $2 = 'paused' THEN COALESCE($3,'manual') ELSE NULL END,
              next_step_at  = CASE WHEN $2 = 'active' AND next_step_at IS NULL THEN NOW() ELSE next_step_at END
        WHERE id = $1 RETURNING *`,
      [req.params.id, status, b.reason ?? null],
    );
    if (r.rowCount === 0) return res.status(404).json({ error: { code: "not_found" } });
    return res.json({ enrollment: r.rows[0] });
  } catch (err) {
    logger.error({ err }, "bi.marketing.enrollments.patch.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.get("/suppressions", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.*, c.full_name AS contact_name
         FROM bi_suppressions s
         LEFT JOIN bi_contacts c ON c.id = s.contact_id
        ORDER BY s.created_at DESC
        LIMIT 1000`,
    );
    return res.json({ suppressions: r.rows });
  } catch (err) {
    logger.error({ err }, "bi.marketing.suppressions.list.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.post("/suppressions", async (req, res) => {
  const b = (req.body || {}) as any;
  if (!b.contact_id && !b.phone_e164 && !b.email) return badRequest(res, "contact_id, phone_e164, or email required");
  try {
    const r = await pool.query(
      `INSERT INTO bi_suppressions (contact_id, phone_e164, email, channel, reason)
            VALUES ($1, $2, $3, COALESCE($4,'all'), COALESCE($5,'manual'))
            RETURNING *`,
      [b.contact_id ?? null, b.phone_e164 ?? null, b.email ?? null, b.channel ?? null, b.reason ?? null],
    );
    return res.status(201).json({ suppression: r.rows[0] });
  } catch (err) {
    logger.error({ err }, "bi.marketing.suppressions.create.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.delete("/suppressions/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM bi_suppressions WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "bi.marketing.suppressions.delete.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.get("/lists", async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM bi_sequence_lists WHERE deleted_at IS NULL ORDER BY updated_at DESC`);
    return res.json({ lists: r.rows });
  } catch (err) {
    logger.error({ err }, "bi.marketing.lists.list.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.post("/lists", async (req, res) => {
  const b = (req.body || {}) as any;
  if (!b.name) return badRequest(res, "name required");
  try {
    const r = await pool.query(
      `INSERT INTO bi_sequence_lists (name, filter_spec, created_by)
            VALUES ($1, COALESCE($2,'{}'::jsonb), $3) RETURNING *`,
      [b.name, JSON.stringify(b.filter_spec ?? {}), (req as any).user?.id ?? null],
    );
    return res.status(201).json({ list: r.rows[0] });
  } catch (err) {
    logger.error({ err }, "bi.marketing.lists.create.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.patch("/lists/:id", async (req, res) => {
  const b = (req.body || {}) as any;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.name !== undefined)        { vals.push(b.name);                        sets.push(`name = $${vals.length}`); }
  if (b.filter_spec !== undefined) { vals.push(JSON.stringify(b.filter_spec)); sets.push(`filter_spec = $${vals.length}::jsonb`); }
  if (sets.length === 0) return badRequest(res, "no updatable fields");
  vals.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE bi_sequence_lists SET ${sets.join(", ")}, updated_at = NOW()
         WHERE id = $${vals.length} AND deleted_at IS NULL RETURNING *`,
      vals,
    );
    if (r.rowCount === 0) return res.status(404).json({ error: { code: "not_found" } });
    return res.json({ list: r.rows[0] });
  } catch (err) {
    logger.error({ err }, "bi.marketing.lists.patch.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.delete("/lists/:id", async (req, res) => {
  try {
    await pool.query(`UPDATE bi_sequence_lists SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "bi.marketing.lists.delete.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.get("/lists/:id/contacts", async (req, res) => {
  try {
    const lr = await pool.query(`SELECT filter_spec FROM bi_sequence_lists WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (lr.rowCount === 0) return res.status(404).json({ error: { code: "not_found" } });
    const spec = lr.rows[0].filter_spec as Record<string, unknown> || {};
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (Array.isArray((spec as any).tags_any) && (spec as any).tags_any.length > 0) {
      vals.push((spec as any).tags_any);
      conds.push(`tags && $${vals.length}::text[]`);
    }
    if ((spec as any).has_email === true) conds.push(`email IS NOT NULL`);
    if ((spec as any).has_phone === true) conds.push(`phone_e164 IS NOT NULL`);
    if (typeof (spec as any).lifecycle_stage === "string") {
      vals.push((spec as any).lifecycle_stage);
      conds.push(`lifecycle_stage = $${vals.length}`);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
    const r = await pool.query(
      `SELECT id, full_name, email, phone_e164, tags, lifecycle_stage
         FROM bi_contacts ${where}
        ORDER BY full_name LIMIT 500`,
      vals,
    );
    return res.json({ contacts: r.rows });
  } catch (err) {
    logger.error({ err }, "bi.marketing.lists.contacts.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.get("/mailbox-health", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT mailbox, channel,
              SUM(sent)::int AS sent,
              SUM(delivered)::int AS delivered,
              SUM(opened)::int AS opened,
              SUM(clicked)::int AS clicked,
              SUM(replied)::int AS replied,
              SUM(bounced)::int AS bounced,
              SUM(spam_complained)::int AS spam_complained,
              MAX(window_start) AS last_window
         FROM bi_mailbox_health
        WHERE window_start >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY mailbox, channel
        ORDER BY mailbox, channel`,
    );
    return res.json({
      mailboxes: r.rows.map((row) => ({
        ...row,
        delivery_rate: row.sent > 0 ? row.delivered / row.sent : null,
        open_rate: row.delivered > 0 ? row.opened / row.delivered : null,
        reply_rate: row.delivered > 0 ? row.replied / row.delivered : null,
        bounce_rate: row.sent > 0 ? row.bounced / row.sent : null,
      })),
    });
  } catch (err) {
    logger.error({ err }, "bi.marketing.mailbox.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

router.get("/analytics", async (req, res) => {
  const seqId = (req.query.sequence_id as string) || null;
  try {
    const args: unknown[] = [];
    let where = "";
    if (seqId) {
      args.push(seqId);
      where = `WHERE e.sequence_id = $${args.length}`;
    }
    const r = await pool.query(
      `SELECT
         COUNT(DISTINCT e.id)                                                       AS enrolled,
         COUNT(DISTINCT ev.id) FILTER (WHERE ev.event_type = 'sent')                 AS sent,
         COUNT(DISTINCT ev.id) FILTER (WHERE ev.event_type = 'delivered')            AS delivered,
         COUNT(DISTINCT ev.id) FILTER (WHERE ev.event_type = 'opened')               AS opened,
         COUNT(DISTINCT ev.id) FILTER (WHERE ev.event_type = 'clicked')              AS clicked,
         COUNT(DISTINCT ev.id) FILTER (WHERE ev.event_type = 'replied')              AS replied,
         COUNT(DISTINCT e.id)  FILTER (WHERE e.status = 'completed')                 AS completed,
         COUNT(DISTINCT e.id)  FILTER (WHERE e.status = 'stopped')                   AS stopped,
         COUNT(DISTINCT e.id)  FILTER (WHERE e.status = 'paused')                    AS paused
       FROM bi_sequence_enrollments e
       LEFT JOIN bi_sequence_events ev ON ev.enrollment_id = e.id
       ${where}`,
      args,
    );
    return res.json({ analytics: r.rows[0] });
  } catch (err) {
    logger.error({ err }, "bi.marketing.analytics.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

// BI_SERVER_BLOCK_BI_ROUND8_MARKETING_v1
router.post("/internal/reply", async (req, res) => {
  const tok = String(req.headers["x-backend-token"] || "");
  if (!tok || tok !== process.env.BI_BACKEND_TOKEN) {
    return res.status(401).json({ error: { code: "unauthorized" } });
  }
  const b = (req.body || {}) as any;
  const phone = String(b.from_phone || "").trim();
  if (!phone) return res.status(400).json({ error: { code: "bad_request", message: "from_phone required" } });
  try {
    const cr = await pool.query(`SELECT id FROM bi_contacts WHERE phone_e164 = $1 LIMIT 1`, [phone]);
    if (cr.rowCount === 0) return res.json({ matched: false });
    const contactId = cr.rows[0].id;
    const er = await pool.query(
      `UPDATE bi_sequence_enrollments e
          SET status = 'paused', paused_reason = 'replied'
         FROM bi_sequences s
        WHERE e.sequence_id = s.id
          AND e.contact_id = $1
          AND e.status = 'active'
          AND s.pause_on_reply = TRUE
        RETURNING e.id, e.sequence_id`,
      [contactId],
    );
    for (const row of er.rows) {
      await pool.query(
        `INSERT INTO bi_sequence_events (enrollment_id, event_type, channel, metadata)
              VALUES ($1, 'replied', 'sms', $2::jsonb)`,
        [row.id, JSON.stringify({ inbound_from: phone, body: b.body ?? null })],
      );
    }
    return res.json({ matched: true, paused: er.rowCount, contact_id: contactId });
  } catch (err) {
    logger.error({ err }, "bi.marketing.internal.reply.failed");
    return res.status(500).json({ error: { code: "internal" } });
  }
});

export default router;
