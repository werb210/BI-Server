// BI_SERVER_v789_PUBLIC_RATE_LIMITS - per-client-IP limiters for public routes.
// Attach these PER ROUTE (or under a path that only this router serves): the
// routers that use them are mounted at "/api/v1" and see every /api/v1 request,
// so a router-wide use() would count, and refuse, unrelated traffic.
//
// The key is the client IP. server.ts sets trust proxy, so req.ip is the
// caller; rateLimitKeyFromRequest resolves the same address from the Azure
// X-Forwarded-For chain (and collapses IPv6 to its /64) so a malformed
// "ip:port" value never reaches express-rate-limit.
import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";
import { rateLimitKeyFromRequest } from "../middleware/rateLimitKey";

export function ipRateLimit(opts: { windowMs: number; limit: number; code?: string }): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => rateLimitKeyFromRequest(req),
    validate: { xForwardedForHeader: false, trustProxy: false },
    handler: (_req, res) => {
      res.status(429).json({ error: opts.code ?? "rate_limited" });
    },
  });
}

/** Client IP as used for throttling (same resolution as the limiters). */
export function clientIpKey(req: Parameters<typeof rateLimitKeyFromRequest>[0]): string {
  return rateLimitKeyFromRequest(req);
}
