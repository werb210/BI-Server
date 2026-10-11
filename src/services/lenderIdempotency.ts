// BI_SERVER_v789_LENDER_IDEMPOTENCY - lender application create honours an
// Idempotency-Key header, persisted in bi_idempotency_keys
// (lender_id, idem_key, route, response jsonb, created_at,
// UNIQUE(lender_id, idem_key, route)).
//
// Flow for a request that carries a key:
//   1. Reserve: INSERT a row with response NULL (ON CONFLICT DO NOTHING).
//   2. Reserved -> run the handler. A 2xx reply is stored ({status, body})
//      before it is sent; any other outcome deletes the reservation so the
//      client can retry with the same key.
//   3. Not reserved -> the stored response is replayed (same status + body)
//      without creating or submitting again. A reservation with no response
//      yet means the first request is still running: 409. A reservation older
//      than STALE_RESERVATION_MS with no response (process died mid-request) is
//      cleared and the request proceeds.
//
// Requests without the header behave as before.
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db";
import { logger } from "../platform/logger";
import { logHiddenError } from "../platform/safeError";

export const LENDER_APPLICATION_CREATE_ROUTE = "POST /api/v1/lender/applications";
export const STALE_RESERVATION_MS = 5 * 60_000;
const MAX_KEY_LENGTH = 255;

type StoredResponse = { status: number; body: unknown };

type ReserveResult =
  | { state: "reserved"; id: string }
  | { state: "replay"; response: StoredResponse }
  | { state: "in_progress" };

async function tryInsert(lenderId: string, key: string, route: string): Promise<string | null> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO bi_idempotency_keys (lender_id, idem_key, route)
     VALUES ($1, $2, $3)
     ON CONFLICT (lender_id, idem_key, route) DO NOTHING
     RETURNING id`,
    [lenderId, key, route],
  );
  return r.rows[0]?.id ?? null;
}

export async function reserveIdempotencyKey(lenderId: string, key: string, route: string): Promise<ReserveResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const id = await tryInsert(lenderId, key, route);
    if (id) return { state: "reserved", id };
    const existing = await pool.query<{ id: string; response: StoredResponse | null; created_at: string | Date }>(
      `SELECT id, response, created_at FROM bi_idempotency_keys
        WHERE lender_id = $1 AND idem_key = $2 AND route = $3
        LIMIT 1`,
      [lenderId, key, route],
    );
    const row = existing.rows[0];
    if (!row) continue; // deleted between the two statements: try again
    if (row.response && typeof row.response === "object" && typeof row.response.status === "number") {
      return { state: "replay", response: row.response };
    }
    const age = Date.now() - new Date(row.created_at).getTime();
    if (!(age > STALE_RESERVATION_MS)) return { state: "in_progress" };
    await pool.query(`DELETE FROM bi_idempotency_keys WHERE id = $1 AND response IS NULL`, [row.id]);
  }
  return { state: "in_progress" };
}

async function releaseReservation(id: string): Promise<void> {
  try {
    await pool.query(`DELETE FROM bi_idempotency_keys WHERE id = $1 AND response IS NULL`, [id]);
  } catch (err) {
    logger.warn({ err, id }, "lender_idempotency_release_failed");
  }
}

async function storeResponse(id: string, response: StoredResponse): Promise<void> {
  try {
    await pool.query(`UPDATE bi_idempotency_keys SET response = $2::jsonb WHERE id = $1`, [id, JSON.stringify(response)]);
  } catch (err) {
    logger.warn({ err, id }, "lender_idempotency_store_failed");
  }
}

/** Header value, or undefined when absent, or null when present but unusable. */
export function readIdempotencyKey(req: Request): string | null | undefined {
  const raw = req.header("idempotency-key");
  if (raw === undefined) return undefined;
  const key = String(raw).trim();
  if (!key || key.length > MAX_KEY_LENGTH) return null;
  return key;
}

/**
 * Middleware; must run after lender auth. `lenderIdOf` returns the
 * authenticated lender id (req.lenderId for the API router).
 */
export function lenderIdempotency(route: string, lenderIdOf: (req: Request) => string | null | undefined) {
  return async function lenderIdempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
    const key = readIdempotencyKey(req);
    if (key === undefined) return next();
    if (key === null) {
      return res.status(400).json({ error: "invalid_idempotency_key", message: `Idempotency-Key must be 1-${MAX_KEY_LENGTH} characters.` });
    }
    const lenderId = lenderIdOf(req);
    if (!lenderId) return next();

    let reserved: ReserveResult;
    try {
      reserved = await reserveIdempotencyKey(String(lenderId), key, route);
    } catch (err) {
      return res.status(503).json({ error: "idempotency_unavailable", requestId: logHiddenError(req, err, "idempotency_unavailable") });
    }
    if (reserved.state === "replay") {
      res.setHeader("Idempotent-Replayed", "true");
      return res.status(reserved.response.status).json(reserved.response.body);
    }
    if (reserved.state === "in_progress") {
      return res.status(409).json({ error: "idempotency_key_in_progress", message: "A request with this Idempotency-Key is still being processed." });
    }

    const reservationId = reserved.id;
    let settled = false;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (settled) return originalJson(body);
      settled = true;
      const status = res.statusCode;
      const work = status >= 200 && status < 300
        ? storeResponse(reservationId, { status, body })
        : releaseReservation(reservationId);
      void work.finally(() => originalJson(body));
      return res;
    }) as Response["json"];
    res.on("close", () => {
      if (!settled) {
        settled = true;
        void releaseReservation(reservationId);
      }
    });
    return next();
  };
}
