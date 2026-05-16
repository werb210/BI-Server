import { pool } from "../db";
import { logger } from "../platform/logger";

const TICK_MS = 60_000;

type Sequence = {
  id: string;
  status: "draft" | "active" | "paused" | "archived";
  send_hours_local_start: number;
  send_hours_local_end: number;
  send_weekdays_only: boolean;
  pause_on_reply: boolean;
  pause_on_bounce: boolean;
  send_rate_cap: number;
  sender_rotation: string[];
};

type Step = {
  id: string;
  position: number;
  type: "sms" | "email" | "task" | "wait";
  delay_seconds: number;
  subject: string | null;
  body: string | null;
  variant: string;
  conditions: Record<string, unknown>;
};

type Enrollment = {
  id: string;
  sequence_id: string;
  contact_id: string;
  status: string;
  current_step: number;
  variant: string;
  contact_email: string | null;
  contact_phone: string | null;
};

const BF_SERVER_URL = process.env.BF_SERVER_URL || "https://server.boreal.financial";
const BI_BACKEND_TOKEN = process.env.BI_BACKEND_TOKEN || "";

async function pickDue(limit: number): Promise<Enrollment[]> {
  const r = await pool.query<Enrollment>(
    `SELECT e.id, e.sequence_id, e.contact_id, e.status, e.current_step, e.variant,
            c.email AS contact_email, c.phone_e164 AS contact_phone
       FROM bi_sequence_enrollments e
       JOIN bi_contacts c ON c.id = e.contact_id
      WHERE e.status = 'active'
        AND e.next_step_at IS NOT NULL
        AND e.next_step_at <= NOW()
      ORDER BY e.next_step_at
      LIMIT $1`,
    [limit],
  );
  return r.rows;
}

async function loadSequence(seqId: string): Promise<Sequence | null> {
  const r = await pool.query(`SELECT * FROM bi_sequences WHERE id = $1`, [seqId]);
  return r.rowCount === 0 ? null : (r.rows[0] as Sequence);
}

async function loadStep(seqId: string, position: number, variant: string): Promise<Step | null> {
  let r = await pool.query(
    `SELECT * FROM bi_sequence_steps WHERE sequence_id = $1 AND position = $2 AND variant = $3 LIMIT 1`,
    [seqId, position, variant],
  );
  if (r.rowCount === 0) {
    r = await pool.query(
      `SELECT * FROM bi_sequence_steps WHERE sequence_id = $1 AND position = $2 ORDER BY variant LIMIT 1`,
      [seqId, position],
    );
  }
  return r.rowCount === 0 ? null : (r.rows[0] as Step);
}

async function isSuppressed(contactId: string, channel: "sms" | "email", phone: string | null, email: string | null): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM bi_suppressions
      WHERE (contact_id = $1
          OR (phone_e164 = $2 AND $2 IS NOT NULL)
          OR (email      = $3 AND $3 IS NOT NULL))
        AND channel IN ('all', $4)
      LIMIT 1`,
    [contactId, phone, email, channel],
  );
  return (r.rowCount ?? 0) > 0;
}

function withinSendWindow(seq: Sequence): boolean {
  const now = new Date();
  const hour = now.getHours();
  if (hour < seq.send_hours_local_start || hour >= seq.send_hours_local_end) return false;
  if (seq.send_weekdays_only) {
    const dow = now.getDay();
    if (dow === 0 || dow === 6) return false;
  }
  return true;
}

async function sendSms(toPhone: string, body: string, sender: string | null): Promise<{ ok: boolean; sid?: string; error?: string }> {
  try {
    const r = await fetch(`${BF_SERVER_URL}/api/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Silo": "BI",
        "X-Backend-Token": BI_BACKEND_TOKEN,
      },
      body: JSON.stringify({ to: toPhone, body, sender }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: `BF-Server SMS ${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
    return { ok: true, sid: (j as any).sid };
  } catch (err: any) {
    return { ok: false, error: err?.message || "fetch failed" };
  }
}

async function sendEmail(toEmail: string, subject: string, body: string, sender: string | null): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const r = await fetch(`${BF_SERVER_URL}/api/o365/mail/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Silo": "BI",
        "X-Backend-Token": BI_BACKEND_TOKEN,
      },
      body: JSON.stringify({ to: toEmail, subject, body, sender }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: `BF-Server email ${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
    return { ok: true, messageId: (j as any).message_id };
  } catch (err: any) {
    return { ok: false, error: err?.message || "fetch failed" };
  }
}

async function recordEvent(enrollmentId: string, stepId: string | null, eventType: string, channel: string | null, senderId: string | null, metadata: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO bi_sequence_events (enrollment_id, step_id, event_type, channel, sender_id, metadata)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [enrollmentId, stepId, eventType, channel, senderId, JSON.stringify(metadata)],
  );
}

async function processOne(enr: Enrollment): Promise<void> {
  const seq = await loadSequence(enr.sequence_id);
  if (!seq || seq.status !== "active") return;
  if (!withinSendWindow(seq)) {
    await pool.query(`UPDATE bi_sequence_enrollments SET next_step_at = NOW() + INTERVAL '1 hour' WHERE id = $1`, [enr.id]);
    return;
  }

  const step = await loadStep(enr.sequence_id, enr.current_step, enr.variant);
  if (!step) {
    await pool.query(
      `UPDATE bi_sequence_enrollments SET status = 'completed', completed_at = NOW(), next_step_at = NULL WHERE id = $1`,
      [enr.id],
    );
    return;
  }

  const skip = (step.conditions || {})["skip_if"] as Record<string, unknown> | undefined;
  if (skip?.on_suppression_list && step.type !== "task" && step.type !== "wait") {
    const ch = step.type as "sms" | "email";
    if (await isSuppressed(enr.contact_id, ch, enr.contact_phone, enr.contact_email)) {
      await recordEvent(enr.id, step.id, "suppressed", ch, null, { reason: "on_suppression_list" });
      await advanceStep(enr.id, enr.current_step + 1);
      return;
    }
  }

  const sender = seq.sender_rotation.length > 0 ? seq.sender_rotation[enr.current_step % seq.sender_rotation.length] : null;

  if (step.type === "sms") {
    if (!enr.contact_phone) {
      await recordEvent(enr.id, step.id, "failed", "sms", sender, { reason: "no_phone" });
      await advanceStep(enr.id, enr.current_step + 1);
      return;
    }
    const result = await sendSms(enr.contact_phone, step.body ?? "", sender);
    if (result.ok) await recordEvent(enr.id, step.id, "sent", "sms", sender, { sid: result.sid });
    else await recordEvent(enr.id, step.id, "failed", "sms", sender, { error: result.error });
  } else if (step.type === "email") {
    if (!enr.contact_email) {
      await recordEvent(enr.id, step.id, "failed", "email", sender, { reason: "no_email" });
      await advanceStep(enr.id, enr.current_step + 1);
      return;
    }
    const result = await sendEmail(enr.contact_email, step.subject ?? "", step.body ?? "", sender);
    if (result.ok) await recordEvent(enr.id, step.id, "sent", "email", sender, { messageId: result.messageId });
    else await recordEvent(enr.id, step.id, "failed", "email", sender, { error: result.error });
  } else if (step.type === "task") {
    await recordEvent(enr.id, step.id, "sent", null, null, { task: step.body });
  } else if (step.type === "wait") {
    await recordEvent(enr.id, step.id, "sent", null, null, { wait_seconds: step.delay_seconds });
  }

  await advanceStep(enr.id, enr.current_step + 1);
}

async function advanceStep(enrollmentId: string, nextPosition: number): Promise<void> {
  const r = await pool.query<{ sequence_id: string }>(`SELECT sequence_id FROM bi_sequence_enrollments WHERE id = $1`, [enrollmentId]);
  if (r.rowCount === 0) return;
  const seqId = r.rows[0].sequence_id;
  const nr = await pool.query<{ delay_seconds: number }>(
    `SELECT delay_seconds FROM bi_sequence_steps WHERE sequence_id = $1 AND position = $2 LIMIT 1`,
    [seqId, nextPosition],
  );
  if (nr.rowCount === 0) {
    await pool.query(
      `UPDATE bi_sequence_enrollments
          SET current_step = $2, last_step_at = NOW(),
              status = 'completed', completed_at = NOW(), next_step_at = NULL
        WHERE id = $1`,
      [enrollmentId, nextPosition],
    );
    return;
  }
  const delay = nr.rows[0].delay_seconds || 0;
  await pool.query(
    `UPDATE bi_sequence_enrollments
        SET current_step = $2, last_step_at = NOW(),
            next_step_at = NOW() + ($3 || ' seconds')::interval
      WHERE id = $1`,
    [enrollmentId, nextPosition, delay],
  );
}

let running = false;
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await pickDue(50);
    for (const enr of due) {
      try { await processOne(enr); } catch (err) { logger.error({ err, enrollmentId: enr.id }, "marketing.worker.step.failed"); }
    }
  } catch (err) {
    logger.error({ err }, "marketing.worker.tick.failed");
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;
export function startMarketingWorker(): void {
  if (timer) return;
  logger.info("marketing.worker.starting");
  timer = setInterval(() => { void tick(); }, TICK_MS);
}

export function stopMarketingWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
