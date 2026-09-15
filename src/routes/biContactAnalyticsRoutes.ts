// BI_SERVER_CONTACT_ANALYTICS_v271
// Data for the portal contact record's Analytics tab in the BI silo. The BF
// versions of these panels call BF-Server with a BI contact id, which can
// never match, so BI contacts showed no stage history and a failing summary.
//   GET /api/v1/bi/crm/contacts/:id/stage-events  application stage changes
//   GET /api/v1/bi/crm/contacts/:id/ai-summary    short AI summary for staff
import { Router } from "express";
import OpenAI from "openai";
import { pool } from "../db";
import { env } from "../platform/env";
import { logger } from "../platform/logger";

type Query = (sql: string, params: unknown[]) => Promise<{ rows: any[] }>;
const defaultQuery: Query = (sql, params) => pool.query(sql, params as any[]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StageEvent = { id: string; application_id: string; from_stage: string | null; to_stage: string; trigger: string | null; created_at: string };

function label(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s.replace(/_/g, " ") : null;
}

export function toStageEvent(row: { id: string; application_id: string; event_type: string; summary: string | null; meta: any; actor_type: string | null; created_at: string }): StageEvent {
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const to = label(meta.to) ?? label(meta.stage) ?? label(row.summary) ?? "stage changed";
  const trigger = label(meta.trigger) ?? (row.actor_type === "staff" ? "changed by staff" : null);
  return { id: row.id, application_id: row.application_id, from_stage: label(meta.from), to_stage: to, trigger, created_at: row.created_at };
}

export async function stageEventsForContact(contactId: string, query: Query = defaultQuery): Promise<StageEvent[]> {
  const { rows } = await query(
    `SELECT a.id::text AS id, a.application_id::text AS application_id, a.event_type, a.summary, a.meta,
            a.actor_type::text AS actor_type, a.created_at
       FROM bi_activity a
       JOIN bi_applications ap ON ap.id = a.application_id
      WHERE ap.primary_contact_id = $1
        AND a.event_type IN ('stage_change', 'application_stage_changed')
      ORDER BY a.created_at DESC
      LIMIT 100`,
    [contactId],
  );
  return rows.map(toStageEvent);
}

export type SummaryModel = (prompt: string) => Promise<string>;

export function buildSummaryPrompt(input: {
  contact: { full_name: string | null; email: string | null; outreach_stage: string | null };
  applications: Array<{ stage: string | null; status: string | null; created_at: string }>;
  activity: Array<{ occurred_at: string; event_type: string | null; outcome: string | null; body: string | null }>;
}): string {
  const lines: string[] = [];
  lines.push(`Contact: ${input.contact.full_name ?? "Unknown"}${input.contact.email ? ` <${input.contact.email}>` : ""}`);
  if (input.contact.outreach_stage) lines.push(`Outreach stage: ${input.contact.outreach_stage}`);
  lines.push(`Applications: ${input.applications.length ? input.applications.map((a) => `${a.stage ?? "unknown"}${a.status ? ` (${a.status})` : ""} since ${String(a.created_at).slice(0, 10)}`).join("; ") : "none"}`);
  lines.push("Recent activity, newest first:");
  for (const a of input.activity.slice(0, 40)) {
    const body = String(a.body ?? "").replace(/\s+/g, " ").slice(0, 240);
    lines.push(`- ${String(a.occurred_at).slice(0, 16)} ${a.event_type ?? "activity"}${a.outcome ? ` [${a.outcome}]` : ""}${body ? `: ${body}` : ""}`);
  }
  if (!input.activity.length) lines.push("- none recorded");
  return lines.join("\n");
}

export async function summaryForContact(contactId: string, model: SummaryModel | null, query: Query = defaultQuery): Promise<{ summary: string } | { error: string; status: number }> {
  const contact = (await query(`SELECT full_name, email, outreach_stage FROM bi_contacts WHERE id = $1 LIMIT 1`, [contactId])).rows[0];
  if (!contact) return { error: "not_found", status: 404 };
  if (!model) return { error: "ai_not_configured", status: 503 };
  const applications = (await query(
    `SELECT stage::text AS stage, status, created_at FROM bi_applications WHERE primary_contact_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [contactId],
  )).rows;
  const activity = (await query(
    `SELECT occurred_at, event_type, outcome, body FROM bi_contact_activity WHERE contact_id = $1 ORDER BY occurred_at DESC LIMIT 40`,
    [contactId],
  )).rows;
  const summary = (await model(buildSummaryPrompt({ contact, applications, activity }))).trim();
  return { summary: summary || "No summary returned." };
}

const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
const defaultModel: SummaryModel | null = openai
  ? async (prompt) => {
      const r = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: "You summarise a Boreal Insurance (personal guarantee insurance) CRM contact for staff. In 3-5 plain sentences: where they stand, what happened recently, and the single most useful next step. Use only the facts given; say when information is missing." },
          { role: "user", content: prompt },
        ],
      });
      return r.choices[0]?.message?.content ?? "";
    }
  : null;

const router = Router();

router.get("/crm/contacts/:id/stage-events", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_contact_id" });
  try {
    return res.json(await stageEventsForContact(id));
  } catch (err) {
    logger.error({ err }, "bi.contacts.stage_events.failed");
    return res.status(500).json({ error: "stage_events_failed" });
  }
});

router.get("/crm/contacts/:id/ai-summary", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_contact_id" });
  try {
    const result = await summaryForContact(id, defaultModel);
    if ("error" in result) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  } catch (err) {
    logger.error({ err }, "bi.contacts.ai_summary.failed");
    return res.status(502).json({ error: "ai_summary_failed" });
  }
});

export default router;
