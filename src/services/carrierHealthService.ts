// BI_SERVER_BLOCK_v234_OPS_HARDENING_v1
import { pool } from "../db";
import { logger } from "../platform/logger";
export type CarrierHealth = { status: "healthy" | "degraded" | "unknown"; submissions_24h: number; received_24h: number; errors_24h: number; last_received_at: string | null; last_error_at: string | null; checked_at: string; };
export async function getCarrierHealth(): Promise<CarrierHealth> {
  const since = "NOW() - INTERVAL '24 hours'";
  const [subs, recv, errs, lastRecv, lastErr] = await Promise.all([
    pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM bi_applications WHERE created_at >= ${since}`),
    pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM bi_applications WHERE carrier_received_at >= ${since}`),
    pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM bi_activity WHERE event_type IN ('carrier_submission_failed','pgi_webhook_failed') AND created_at >= ${since}`),
    pool.query<{ t: string | null }>(`SELECT MAX(carrier_received_at)::text AS t FROM bi_applications`),
    pool.query<{ t: string | null }>(`SELECT MAX(created_at)::text AS t FROM bi_activity WHERE event_type IN ('carrier_submission_failed','pgi_webhook_failed')`),
  ]);
  const submissions = Number(subs.rows[0]?.n || "0"); const received = Number(recv.rows[0]?.n || "0"); const errors = Number(errs.rows[0]?.n || "0");
  let status: CarrierHealth["status"] = "unknown"; if (submissions === 0) status = "unknown"; else if (errors === 0 && received > 0) status = "healthy"; else status = "degraded";
  return { status, submissions_24h: submissions, received_24h: received, errors_24h: errors, last_received_at: lastRecv.rows[0]?.t || null, last_error_at: lastErr.rows[0]?.t || null, checked_at: new Date().toISOString() };
}
let lastStatus: CarrierHealth["status"] | null = null;
export async function runCarrierHealthTick(): Promise<void> { try { const h = await getCarrierHealth(); if (h.status === "degraded" && lastStatus !== "degraded") { await pool.query(`INSERT INTO bi_activity (application_id, actor_type, event_type, summary, meta) VALUES (NULL, 'system', 'carrier_health_degraded', $1, $2::jsonb)`, [`Carrier degraded: ${h.submissions_24h} submissions, ${h.received_24h} received, ${h.errors_24h} errors in 24h`, JSON.stringify(h)]).catch(() => {}); logger.warn({ health: h }, "[carrierHealth] degraded — see bi_activity"); } else if (h.status === "healthy" && lastStatus === "degraded") logger.info({ health: h }, "[carrierHealth] recovered to healthy"); lastStatus = h.status; } catch (err) { logger.error({ err }, "[carrierHealth] tick failed"); } }
export function startCarrierHealthJob(): void { const TICK_MS = 60 * 60 * 1000; const handle = setInterval(() => { runCarrierHealthTick().catch(() => {}); }, TICK_MS); if (typeof (handle as any).unref === "function") (handle as any).unref(); setTimeout(() => { runCarrierHealthTick().catch(() => {}); }, 45_000).unref(); logger.info({ TICK_MS }, "[carrierHealth] startCarrierHealthJob: scheduled"); }
