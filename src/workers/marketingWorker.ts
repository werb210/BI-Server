import { pool } from "../db";
import { logger } from "../platform/logger";
import { isSendableAt, nextSendableAt, scheduleFromNow, type SendWindow } from "../services/sequenceSchedule";
import { resolveEmailContent } from "../services/sequenceEmailContent"; // BI_SEQ_EMAIL_TEMPLATE_AT_SEND_v373
import { backendTokenProblem, RETRY_DELAY_MINUTES, shouldRetrySend } from "../services/backendToken"; // BI_SERVER_BACKEND_TOKEN_CHECK_v372

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
  assignee_user_id: string | null;
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
// BACKEND_SERVICE_TOKEN is shared with BF-Server's service bridge. Keep the
// legacy name as a transition fallback for existing App Service deployments.
const BACKEND_SERVICE_TOKEN = (process.env.BACKEND_SERVICE_TOKEN || process.env.BI_BACKEND_TOKEN || "").trim();
const TOKEN_PROBLEM = backendTokenProblem(BACKEND_SERVICE_TOKEN);

// BI_SERVER_SEQ_CLAIM_v405 - the production and staging slots (and any scaled-out
// instance) each run this worker. The old query only READ due enrollments, so two
// workers could pick the same one in the same minute and send the email twice.
// Claiming now happens in one statement: due rows are locked (SKIP LOCKED, so a
// second worker skips them) and pushed 5 minutes ahead as a lease. Sending,
// advancing or retrying sets next_step_at as before; if a worker dies mid-send,
// the lease simply expires and the step is picked up again.
export const CLAIM_LEASE_SQL = "NOW() + interval '5 minutes'";
async function pickDue(limit: number): Promise<Enrollment[]> {
  const r = await pool.query<Enrollment>(
    `WITH due AS (
       SELECT e.id
         FROM bi_sequence_enrollments e
        WHERE e.status = 'active'
          AND e.next_step_at IS NOT NULL
          AND e.next_step_at <= NOW()
        ORDER BY e.next_step_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     ), claimed AS (
       UPDATE bi_sequence_enrollments e
          SET next_step_at = ${CLAIM_LEASE_SQL}
         FROM due
        WHERE e.id = due.id
        RETURNING e.id, e.sequence_id, e.contact_id, e.status, e.current_step, e.variant
     )
     SELECT claimed.*, c.email AS contact_email, c.phone_e164 AS contact_phone
       FROM claimed
       JOIN bi_contacts c ON c.id = claimed.contact_id`,
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

function sendWindow(seq: Sequence): SendWindow {
  return {
    startHour: Number(seq.send_hours_local_start ?? 9),
    endHour: Number(seq.send_hours_local_end ?? 21),
    weekdaysOnly: seq.send_weekdays_only !== false,
  };
}

async function sendSms(toPhone: string, body: string, sender: string | null): Promise<{ ok: boolean; sid?: string; error?: string }> {
  if (TOKEN_PROBLEM) return { ok: false, error: TOKEN_PROBLEM };
  try {
    const r = await fetch(`${BF_SERVER_URL}/api/service/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Silo": "BI",
        "X-Backend-Token": BACKEND_SERVICE_TOKEN,
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

async function sendEmail(toEmail: string, subject: string, body: string, sender: string | null): Promise<{ ok: boolean; messageId?: string; sentAs?: string; error?: string }> {
  if (TOKEN_PROBLEM) return { ok: false, error: TOKEN_PROBLEM };
  try {
    const r = await fetch(`${BF_SERVER_URL}/api/service/mail`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Silo": "BI",
        "X-Backend-Token": BACKEND_SERVICE_TOKEN,
      },
      body: JSON.stringify({ to: toEmail, subject, html: body, text: body, sendAs: sender }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: `BF-Server email ${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
    return { ok: true, messageId: (j as any).messageId, sentAs: (j as any).sentAs ?? undefined }; // BI_SERVER_BLOCK_v516
  } catch (err: any) {
    return { ok: false, error: err?.message || "fetch failed" };
  }
}

async function createTask(
  assigneeUserId: string,
  title: string,
  description: string,
): Promise<{ ok: boolean; taskId?: string; error?: string }> {
  if (TOKEN_PROBLEM) return { ok: false, error: TOKEN_PROBLEM };
  try {
    const r = await fetch(`${BF_SERVER_URL}/api/service/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Silo": "BI",
        "X-Backend-Token": BACKEND_SERVICE_TOKEN,
      },
      body: JSON.stringify({
        assignee_user_id: assigneeUserId,
        title,
        notes: description,
        type: "TODO",
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: `BF-Server task ${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
    return { ok: true, taskId: String((j as any).task_id ?? (j as any).id ?? "") || undefined };
  } catch (err: any) {
    return { ok: false, error: err?.message || "fetch failed" };
  }
}

async function loadEmailTemplate(templateId: string): Promise<{ subject: string | null; body: string | null } | null> {
  const r = await pool.query<{ subject: string | null; body: string | null }>(
    `SELECT subject, COALESCE(NULLIF(body_html, ''), body_text) AS body
       FROM bi_email_templates WHERE id::text = $1 LIMIT 1`,
    [templateId],
  );
  return r.rows[0] ?? null;
}

async function recordEvent(enrollmentId: string, stepId: string | null, eventType: string, channel: string | null, senderId: string | null, metadata: Record<string, unknown>): Promise<void> {
  // BI_SERVER_SEQUENCE_SEND_LOGS_v354 - a failed send used to be written only to
  // bi_sequence_events, so a sequence could run end to end sending nothing while
  // the log stream stayed silent. Every outcome is now logged with its reason.
  // The metadata never carries message bodies, phone numbers or email addresses.
  const logFields = { enrollmentId, stepId, channel, ...metadata };
  if (eventType === "failed") logger.warn(logFields, "marketing.worker.send.failed");
  else logger.info(logFields, `marketing.worker.send.${eventType}`);
  await pool.query(
    `INSERT INTO bi_sequence_events (enrollment_id, step_id, event_type, channel, sender_id, metadata)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [enrollmentId, stepId, eventType, channel, senderId, JSON.stringify(metadata)],
  );
}

// BI_SERVER_BLOCK_v516_SEQUENCE_TOUCH_LOGGING - a sequence send used to be written
// only to bi_sequence_events. The contact's activity feed never showed it and
// the outreach card never left New, because only a manually logged touch
// (biOutreachCrmRoutes v852) advanced the status. Every successful sequence
// email/SMS now does both. Never throws: a logging failure must not undo a send.
async function logSequenceTouch(
  contactId: string,
  channel: "email" | "sms",
  summary: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO bi_contact_activity
         (id, contact_id, actor_id, actor_name, event_type, outcome, body, meta)
       VALUES (gen_random_uuid(), $1, NULL, 'Sequence', $2, 'sent', $3, $4::jsonb)`,
      [contactId, channel, summary.slice(0, 1000), JSON.stringify(meta)],
    );
  } catch (err) {
    logger.warn({ contactId, channel, err: (err as Error)?.message }, "marketing.worker.touch_activity_failed");
  }
  try {
    await pool.query(
      `UPDATE bi_contacts
          SET outreach_status = 'contacted', outreach_updated_at = NOW()
        WHERE id = $1
          AND COALESCE(outreach_status, 'new') IN ('new', 'cold', 'attempting', 'voicemail')`,
      [contactId],
    );
  } catch (err) {
    logger.warn({ contactId, err: (err as Error)?.message }, "marketing.worker.touch_status_failed");
  }
}

// BI_SERVER_BLOCK_v511 - BI_SEQUENCE_DEFAULT_SENDER overrides; andrew@ otherwise.
export function biDefaultSender(): string {
  const v = String(process.env.BI_SEQUENCE_DEFAULT_SENDER ?? "").trim();
  return v.includes("@") ? v : "andrew@boreal.financial";
}

async function processOne(enr: Enrollment): Promise<void> {
  const seq = await loadSequence(enr.sequence_id);
  if (!seq || seq.status !== "active") {
    // BI_SERVER_SEQ_PARK_INACTIVE_v408 - v405 claims a due enrollment by pushing
    // next_step_at five minutes ahead, then this branch returned without clearing
    // it. Enrollments on a paused, archived or deleted sequence were therefore
    // re-claimed every five minutes forever. Clearing next_step_at parks them;
    // resuming a sequence already restores it with COALESCE(next_step_at, NOW()).
    await pool.query(`UPDATE bi_sequence_enrollments SET next_step_at = NULL WHERE id = $1`, [enr.id]);
    logger.info(
      { enrollmentId: enr.id, sequenceId: enr.sequence_id, sequenceStatus: seq?.status ?? "missing" },
      "marketing.worker.parked_inactive",
    );
    return;
  }
  // BI_SEQ_BUSINESS_HOURS_v1: evaluate in America/Edmonton and jump directly
  // to the next opening rather than repeatedly claiming a closed enrollment.
  if (!isSendableAt(new Date(), sendWindow(seq))) {
    await pool.query(`UPDATE bi_sequence_enrollments SET next_step_at = $2 WHERE id = $1`, [
      enr.id,
      nextSendableAt(new Date(), sendWindow(seq)),
    ]);
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

  // BI_SERVER_BLOCK_v511_BI_SEQUENCE_SENDER - a sequence with no sender chosen
  // used to pass sendAs=null, and BF-Server then sent from its own default
  // mailbox (submissions@boreal.financial, BF's lender inbox). BI emails always
  // go out from a BI sender: the sequence's rotation, else the BI default.
  const rotation = Array.isArray(seq.sender_rotation) ? seq.sender_rotation.filter((x) => typeof x === "string" && x.includes("@")) : [];
  const sender = rotation.length > 0 ? rotation[enr.current_step % rotation.length] : biDefaultSender();
  // BI_SEQ_SEND_RETRY_v372 - a failed send used to advance to the next step
  // exactly like a successful one. With a bad token, a whole sequence ran to
  // "completed" in three minutes having sent nothing. Retry the same step
  // instead, and only move on after MAX_SEND_ATTEMPTS failures.
  let failedSend = false;

  if (step.type === "sms") {
    if (!enr.contact_phone) {
      await recordEvent(enr.id, step.id, "failed", "sms", sender, { reason: "no_phone" });
      await advanceStep(enr.id, enr.current_step + 1);
      return;
    }
    const result = await sendSms(enr.contact_phone, step.body ?? "", sender);
    if (result.ok) {
      await recordEvent(enr.id, step.id, "sent", "sms", sender, { sid: result.sid });
      await logSequenceTouch(enr.contact_id, "sms", step.body ?? "", { sequence_id: enr.sequence_id, step_id: step.id, sid: result.sid ?? null }); // BI_SERVER_BLOCK_v516
    }
    else { await recordEvent(enr.id, step.id, "failed", "sms", sender, { error: result.error }); failedSend = true; }
  } else if (step.type === "email") {
    if (!enr.contact_email) {
      await recordEvent(enr.id, step.id, "failed", "email", sender, { reason: "no_email" });
      await advanceStep(enr.id, enr.current_step + 1);
      return;
    }
    // BI_SEQ_EMAIL_TEMPLATE_AT_SEND_v373 - fill a blank subject/body from the
    // step's template; a step with no content cannot succeed, so report it once.
    const content = await resolveEmailContent(step, loadEmailTemplate);
    if (!content) {
      await recordEvent(enr.id, step.id, "failed", "email", sender, { reason: "empty_email_step" });
      await advanceStep(enr.id, enr.current_step + 1);
      return;
    }
    const result = await sendEmail(enr.contact_email, content.subject, content.body, sender);
    if (result.ok) {
      await recordEvent(enr.id, step.id, "sent", "email", sender, { messageId: result.messageId, sentAs: result.sentAs ?? sender });
      await logSequenceTouch(enr.contact_id, "email", `Sequence email: ${content.subject}`, { sequence_id: enr.sequence_id, step_id: step.id, sent_as: result.sentAs ?? sender }); // BI_SERVER_BLOCK_v516
    }
    else { await recordEvent(enr.id, step.id, "failed", "email", sender, { error: result.error }); failedSend = true; }
  } else if (step.type === "task") {
    if (!step.assignee_user_id) {
      await recordEvent(enr.id, step.id, "failed", null, null, { reason: "no_assignee" });
    } else {
      const result = await createTask(
        step.assignee_user_id,
        step.subject?.trim() || "BI sequence task",
        step.body ?? "",
      );
      if (result.ok) {
        await recordEvent(enr.id, step.id, "sent", null, step.assignee_user_id, { task_id: result.taskId });
      } else {
        await recordEvent(enr.id, step.id, "failed", null, step.assignee_user_id, { error: result.error });
        failedSend = true;
      }
    }
  } else if (step.type === "wait") {
    await recordEvent(enr.id, step.id, "sent", null, null, { wait_seconds: step.delay_seconds });
  }

  if (failedSend) {
    await retryOrAdvance(enr, step.id);
    return;
  }
  await advanceStep(enr.id, enr.current_step + 1);
}

// BI_SEQ_SEND_RETRY_v372 - failures are counted per step since this enrollment
// (re)started, so a restarted sequence gets fresh attempts.
async function retryOrAdvance(enr: Enrollment, stepId: string): Promise<void> {
  const r = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM bi_sequence_events ev
       JOIN bi_sequence_enrollments e ON e.id = ev.enrollment_id
      WHERE ev.enrollment_id = $1 AND ev.step_id = $2
        AND ev.event_type = 'failed' AND ev.created_at >= e.started_at`,
    [enr.id, stepId],
  );
  const failures = Number(r.rows[0]?.n ?? 0);
  if (shouldRetrySend(failures)) {
    logger.warn({ enrollmentId: enr.id, stepId, failures }, "marketing.worker.send.retry_scheduled");
    await pool.query(
      `UPDATE bi_sequence_enrollments SET next_step_at = NOW() + ($2 || ' minutes')::interval WHERE id = $1`,
      [enr.id, String(RETRY_DELAY_MINUTES)],
    );
    return;
  }
  logger.warn({ enrollmentId: enr.id, stepId, failures }, "marketing.worker.send.gave_up");
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
  const sequence = await loadSequence(seqId);
  if (!sequence) return;
  const dueAt = scheduleFromNow(delay, sendWindow(sequence));
  await pool.query(
    `UPDATE bi_sequence_enrollments
        SET current_step = $2, last_step_at = NOW(),
            next_step_at = $3
      WHERE id = $1`,
    [enrollmentId, nextPosition, dueAt],
  );
}

let running = false;
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await pickDue(50);
    // BI_SERVER_SEQ_HEARTBEAT_v408 - the tick logged only when work existed, so a
    // silent log stream could mean nothing was due OR the worker was not running.
    // One line every tick, always, with the backlog sitting behind it.
    const gauge = await pool.query<{ active: string; due_now: string; scheduled: string }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'active')::text AS active,
              COUNT(*) FILTER (WHERE status = 'active' AND next_step_at IS NOT NULL AND next_step_at <= NOW())::text AS due_now,
              COUNT(*) FILTER (WHERE status = 'active' AND next_step_at > NOW())::text AS scheduled
         FROM bi_sequence_enrollments`,
    );
    logger.info(
      {
        claimed: due.length,
        active: Number(gauge.rows[0]?.active ?? 0),
        dueNow: Number(gauge.rows[0]?.due_now ?? 0),
        scheduled: Number(gauge.rows[0]?.scheduled ?? 0),
      },
      "marketing.worker.tick",
    );
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
  if (TOKEN_PROBLEM) logger.error({ problem: TOKEN_PROBLEM }, "marketing.worker.backend_token_invalid");
  timer = setInterval(() => { void tick(); }, TICK_MS);
}

export function stopMarketingWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
