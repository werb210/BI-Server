// BI_SERVER_SENDGRID_SUPPRESSION_SYNC_v721
// SendGrid keeps its own unsubscribe / spam-report / bounce lists and blocks further SendGrid mail to those
// addresses - but BI sequences go out through Microsoft, not SendGrid, so they only respect bi_suppressions.
// Unsubscribes only reached bi_suppressions through the event webhook, and SendGrid's Global Unsubscribes list
// shows people (e.g. kelly@integritylaw.co, 2026-10-09) that never arrived here. This worker copies SendGrid's
// lists into bi_suppressions every hour, so an unsubscribe is honoured on every channel whatever the webhook does.
import { pool } from "../db";
import { logger } from "../platform/logger";

type Kind = { path: string; reason: string; keep?: (row: any) => boolean };
const KINDS: Kind[] = [
  { path: "/v3/suppression/unsubscribes", reason: "sendgrid_unsubscribe" },
  { path: "/v3/suppression/spam_reports", reason: "sendgrid_spam_report" },
  // only permanent bounces (5.x.x); temporary ones are not a reason to stop writing to someone
  { path: "/v3/suppression/bounces", reason: "sendgrid_bounce", keep: (r) => /^5\./.test(String(r?.status ?? "5.")) },
];
const PAGE = 500;

export async function fetchSuppressed(apiKey: string, kind: Kind, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const r = await fetchImpl(`https://api.sendgrid.com${kind.path}?limit=${PAGE}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`sendgrid_${r.status}_${kind.reason}`);
    const rows = (await r.json()) as any[];
    if (!Array.isArray(rows)) break;
    for (const row of rows) {
      const email = String(row?.email ?? "").trim().toLowerCase();
      if (email && (!kind.keep || kind.keep(row))) out.push(email);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function syncSendgridSuppressions(fetchImpl: typeof fetch = fetch): Promise<{ checked: number; added: number }> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return { checked: 0, added: 0 };
  let checked = 0, added = 0;
  for (const kind of KINDS) {
    const emails = Array.from(new Set(await fetchSuppressed(apiKey, kind, fetchImpl)));
    checked += emails.length;
    if (!emails.length) continue;
    const r = await pool.query(
      `INSERT INTO bi_suppressions (identifier, email, channel, reason)
       SELECT e, e, 'email', $2 FROM unnest($1::text[]) AS e
        WHERE NOT EXISTS (
          SELECT 1 FROM bi_suppressions s
           WHERE (lower(s.email) = e OR lower(s.identifier) = e) AND s.channel IN ('email', 'all'))`,
      [emails, kind.reason],
    );
    added += r.rowCount ?? 0;
  }
  return { checked, added };
}

let timer: NodeJS.Timeout | null = null;
export function startSendgridSuppressionSync(): void {
  if (timer || !process.env.SENDGRID_API_KEY) return;
  const run = () => syncSendgridSuppressions()
    .then((r) => logger.info(r, "sendgrid_suppression_sync"))
    .catch((err) => logger.error({ err: err instanceof Error ? err.message : String(err) }, "sendgrid_suppression_sync.failed"));
  void run();
  timer = setInterval(run, 60 * 60 * 1000);
}
