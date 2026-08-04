// BI_SERVER_SEQUENCES_LIVE_SCHEMA_v4
//
// The sequence step routes use the schema verified on bi-pg01 on 2026-08-03.
// The six base sequence handlers live in biMarketingRoutes, which is mounted
// first on the same prefix; keeping duplicate handlers here made their behavior
// depend silently on mount order.
import { Router } from "express";
import { pool } from "../db";
import { handleGraphReplyWebhook } from "../integrations/microsoftGraphSubscriptions";

const router = Router();
const userIdOf = (req: any) => req.user?.id ?? req.user?.staffUserId;

function delaySecondsFrom(body: any): number | null {
  if (body?.delay_seconds !== undefined && body?.delay_seconds !== null) {
    const seconds = Number(body.delay_seconds);
    return Number.isFinite(seconds) ? Math.max(0, Math.trunc(seconds)) : null;
  }
  if (body?.delay_days !== undefined && body?.delay_days !== null) {
    const days = Number(body.delay_days);
    return Number.isFinite(days) ? Math.max(0, Math.trunc(days * 86400)) : null;
  }
  return null;
}

const positionFrom = (body: any) => body?.position ?? body?.step_number ?? null;
const bodyTextFrom = (body: any) => body?.body ?? body?.body_template ?? null;
const assigneeFrom = (body: any) => body?.assignee_user_id ?? body?.send_as_user_id ?? null;

router.get("/sequences/:id/steps", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, sequence_id, position, type, delay_seconds, subject, body,
              variant, conditions, created_at, assignee_user_id
         FROM bi_sequence_steps
        WHERE sequence_id = $1
        ORDER BY position ASC`,
      [req.params.id],
    );
    res.json({ steps: r.rows });
  } catch (err) {
    console.error("[bi_sequences] list steps failed", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "steps_list_failed" });
  }
});

router.post("/sequences/:id/steps", async (req, res) => {
  try {
    const r = await pool.query(
      `INSERT INTO bi_sequence_steps
         (sequence_id, position, type, delay_seconds, subject, body, assignee_user_id)
       VALUES ($1, COALESCE($2, (SELECT COALESCE(MAX(position), 0) + 1
                                   FROM bi_sequence_steps WHERE sequence_id = $1)),
               COALESCE($3, 'email'), COALESCE($4, 0), $5, $6, $7)
       RETURNING *`,
      [
        req.params.id,
        positionFrom(req.body),
        req.body?.type ?? null,
        delaySecondsFrom(req.body),
        req.body?.subject ?? null,
        bodyTextFrom(req.body),
        assigneeFrom(req.body),
      ],
    );
    res.status(201).json({ step: r.rows[0] });
  } catch (err) {
    console.error("[bi_sequences] create step failed", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "step_create_failed" });
  }
});

router.patch("/sequences/:id/steps/:stepId", async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE bi_sequence_steps
          SET position         = COALESCE($2, position),
              delay_seconds    = COALESCE($3, delay_seconds),
              subject          = COALESCE($4, subject),
              body             = COALESCE($5, body),
              assignee_user_id = COALESCE($6, assignee_user_id)
        WHERE id = $1 AND sequence_id = $7
        RETURNING *`,
      [
        req.params.stepId,
        positionFrom(req.body),
        delaySecondsFrom(req.body),
        req.body?.subject ?? null,
        bodyTextFrom(req.body),
        assigneeFrom(req.body),
        req.params.id,
      ],
    );
    if (!r.rows[0]) return res.status(404).json({ error: "not_found" });
    res.json({ step: r.rows[0] });
  } catch (err) {
    console.error("[bi_sequences] update step failed", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "step_update_failed" });
  }
});

router.delete("/sequences/:id/steps/:stepId", async (req, res) => {
  await pool.query(`DELETE FROM bi_sequence_steps WHERE id=$1 AND sequence_id=$2`, [req.params.stepId, req.params.id]);
  res.json({ ok: true });
});

router.post("/sequences/enrollments/:id/pause", async (req, res) => {
  await pool.query(`UPDATE bi_sequence_enrollments SET status='paused' WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});
router.post("/sequences/enrollments/:id/resume", async (req, res) => {
  await pool.query(`UPDATE bi_sequence_enrollments SET status='active', next_send_at=COALESCE(next_send_at,NOW()) WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});
router.post("/sequences/enrollments/:id/stop", async (req, res) => {
  await pool.query(`UPDATE bi_sequence_enrollments SET status='stopped', next_send_at=NULL WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

router.get("/quotas/me", async (req, res) =>
  res.json({ quota: (await pool.query(`SELECT * FROM bi_user_send_quotas WHERE user_id=$1`, [userIdOf(req)])).rows[0] ?? null }));
router.get("/quotas", async (_req, res) =>
  res.json({ quotas: (await pool.query(`SELECT * FROM bi_user_send_quotas ORDER BY updated_at DESC`)).rows }));
router.patch("/quotas/:userId", async (req, res) =>
  res.json({ quota: (await pool.query(
    `INSERT INTO bi_user_send_quotas (user_id, daily_limit) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET daily_limit=$2, updated_at=NOW() RETURNING *`,
    [req.params.userId, req.body?.daily_limit])).rows[0] }));

router.post("/integrations/m365/webhook", async (req, res) => {
  if (Array.isArray(req.body?.value)) await handleGraphReplyWebhook(req.body.value);
  res.status(202).json({ ok: true });
});

export default router;
