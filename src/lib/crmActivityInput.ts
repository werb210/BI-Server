// BI_SERVER_v789_CRM_ACTIVITY_INPUT - one validator for CRM activity rows.
// Used by POST /crm/outreach/contacts/:id/activity (bi_contact_activity) and
// POST /crm/companies/:id/activity (bi_company_activity) so both accept the
// same event types and trim body/outcome/meta the same way.
import type { Request } from "express";

export const CRM_ACTIVITY_EVENT_TYPES: ReadonlySet<string> = new Set([
  "call",
  "demo",
  "sms",
  "email",
  "note",
  "task", // BI_SERVER_BLOCK_v852_OUTREACH_AUTOADVANCE - BI cards log tasks/meetings like BF
  "meeting",
  "status_change",
  "import",
]);

function trimmed(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

export type CrmActivityInput = {
  eventType: string;
  outcome: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
};

/** Validate an activity body: { event_type, outcome?, body?, meta? }. */
export function parseCrmActivityInput(
  raw: unknown,
): { ok: true; value: CrmActivityInput } | { ok: false; error: "invalid_event_type" } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const eventType = trimmed(b.event_type, 1000);
  if (!eventType || !CRM_ACTIVITY_EVENT_TYPES.has(eventType)) return { ok: false, error: "invalid_event_type" };
  const meta = b.meta && typeof b.meta === "object" ? (b.meta as Record<string, unknown>) : null;
  return {
    ok: true,
    value: {
      eventType,
      outcome: trimmed(b.outcome, 1000),
      body: trimmed(b.body, 8000),
      meta,
    },
  };
}

/** The staff member recorded as the actor of an activity row. */
export function crmActorFrom(req: Request): { id: string | null; name: string | null } {
  const u = (req as unknown as { user?: Record<string, unknown> }).user;
  const id = typeof u?.staffUserId === "string" ? u.staffUserId : null;
  const name =
    (typeof u?.displayName === "string" ? u.displayName : null) ??
    (typeof u?.full_name === "string" ? u.full_name : null);
  return { id, name };
}

/**
 * BI_SERVER_v789_NO_ERR_MESSAGE - activity rows written before v789 stored the
 * SMS provider's error text in meta.error. Replace it with a code on the way
 * out so no activity response carries provider text.
 */
export function redactActivityRows<T>(rows: T[]): T[] {
  return rows.map((row) => {
    const meta = (row as { meta?: unknown })?.meta;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return row;
    const err = (meta as Record<string, unknown>).error;
    if (err === undefined || err === null) return row;
    return { ...row, meta: { ...(meta as Record<string, unknown>), error: "sms_failed" } };
  });
}
