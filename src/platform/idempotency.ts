import crypto from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { getStaffVerifySecrets } from "./jwtSecret";
import { verifyBiToken } from "./serviceTokens";

// BI_SERVER_v789_IDEMPOTENCY
// The Idempotency-Key guard used to be one global Map keyed by the raw header
// value: two different callers who happened to pick the same key collided, the
// Map grew without bound for an hour, and a request that failed with a 5xx kept
// its key so the caller's genuine retry was refused with 409 for an hour.
//   - key = principal id + route + header value
//   - bounded LRU (10,000 entries, oldest evicted first), 1 hour TTL
//   - the key is released when the response is a 5xx (or the connection drops
//     before a response), so a genuine retry goes through
// Routes that persist their own idempotent responses (lender application
// create, bi_idempotency_keys) are skipped: a repeat there must get the stored
// response, not a 409.
export const IDEMPOTENCY_MAX_ENTRIES = 10_000;
const TTL_MS = 60 * 60 * 1000;

const PERSISTENT_ROUTES = [/^\/api\/v1\/(bi\/)?lender\/applications\/?$/];

class LruTtl {
  private map = new Map<string, number>();
  constructor(private max: number) {}
  has(key: string, now = Date.now()): boolean {
    const exp = this.map.get(key);
    if (exp === undefined) return false;
    if (exp <= now) {
      this.map.delete(key);
      return false;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, exp);
    return true;
  }
  add(key: string, now = Date.now()): void {
    this.map.delete(key);
    this.map.set(key, now + TTL_MS);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  delete(key: string): void {
    this.map.delete(key);
  }
  get size(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
}

const seen = new LruTtl(IDEMPOTENCY_MAX_ENTRIES);

/** Test hook. */
export function _idempotencyStore() {
  return seen;
}

function sha(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Stable id for the caller: verified token subject, else a hash of the credential, else the client IP. */
export function principalId(req: Request): string {
  const auth = String(req.headers.authorization ?? "").trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  if (bearer) {
    let claims: Record<string, unknown> | null = null;
    try {
      claims = verifyBiToken(bearer, getStaffVerifySecrets());
    } catch {
      claims = null;
    }
    if (claims) {
      const id = claims.sub ?? claims.staffUserId ?? claims.id ?? claims.user_id ?? claims.phone ?? claims.source;
      if (id !== undefined && id !== null && String(id)) return `tok:${String(claims.kind ?? claims.role ?? "")}:${String(id)}`;
    }
    return `cred:${sha(bearer)}`;
  }
  const apiKey = String(req.headers["x-api-key"] ?? "").trim();
  if (apiKey) return `key:${sha(apiKey)}`;
  return `ip:${req.ip ?? "unknown"}`;
}

export function idempotency(req: Request, res: Response, next: NextFunction) {
  if (!["POST", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const header = req.headers["idempotency-key"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return next();

  const route = String(req.originalUrl || req.url || "").split("?")[0];
  if (PERSISTENT_ROUTES.some((re) => re.test(route))) return next();

  const key = `${principalId(req)}|${req.method} ${route}|${value}`;

  if (seen.has(key)) {
    return res.status(409).json({
      success: false,
      error: "Duplicate request"
    });
  }

  seen.add(key);

  let settled = false;
  res.on("finish", () => {
    settled = true;
    if (res.statusCode >= 500) seen.delete(key);
  });
  res.on("close", () => {
    if (!settled && !res.writableFinished) seen.delete(key);
  });

  next();
}
