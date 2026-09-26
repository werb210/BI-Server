// BI_SERVER_BLOCK_v568_BI_VISITOR_JOURNEY
// Same shape as BF-Server's /api/crm/contacts/:id/journey so the portal reuses one
// component. A visit is linked to an application the moment the visitor lands on
// any /applications/<publicId>/... page, so no change to the application flow.
export type JourneyEvent = { type: string; path?: string | null; title?: string | null; step?: string | null; dwellMs?: number | null };
export type JourneyPayload = { sessionId: string; attribution: Record<string, unknown>; events: JourneyEvent[] };

const str = (v: unknown, max = 512): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);

export function parseJourneyBody(raw: unknown): JourneyPayload | null {
  let b: any = raw;
  if (typeof raw === "string") { try { b = JSON.parse(raw); } catch { return null; } }
  const sessionId = str(b?.sessionId, 100);
  if (!sessionId) return null;
  const events = (Array.isArray(b?.events) ? b.events : []).slice(0, 50)
    .map((e: any) => ({
      type: str(e?.type, 60) ?? "",
      path: str(e?.path), title: str(e?.title, 200), step: str(e?.step, 80),
      dwellMs: Number.isFinite(Number(e?.dwellMs)) ? Math.min(Math.max(Math.round(Number(e.dwellMs)), 0), 86_400_000) : null,
    }))
    .filter((e: JourneyEvent) => e.type);
  const attribution = b?.attribution && typeof b.attribution === "object" ? b.attribution : {};
  return { sessionId, attribution, events };
}

export function publicIdFromPath(path: string | null | undefined): string | null {
  const m = /^\/applications\/([A-Za-z0-9_-]{4,64})(\/|$)/.exec(String(path ?? ""));
  return m && m[1] !== "new" ? m[1] : null;
}

export function summarise(events: Array<{ event_type: string; path: string | null; dwell_ms: number | null }>) {
  const pageviews = events.filter((e) => e.event_type === "pageview");
  const submitted = events.some((e) => e.event_type === "application_submitted" || /\/thanks$/.test(e.path ?? ""));
  return {
    pageviewCount: pageviews.length,
    totalDwellMs: pageviews.reduce((acc, e) => acc + (Number(e.dwell_ms) || 0), 0),
    exitPage: submitted ? null : pageviews.length ? pageviews[pageviews.length - 1].path : null,
    lastWizardStep: null,
    submitted,
  };
}
