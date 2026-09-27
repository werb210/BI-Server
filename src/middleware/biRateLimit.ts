import rateLimit from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { rateLimitKeyFromRequest } from "./rateLimitKey";

// BI_RATE_LIMIT_BUDGET_v1
// 500 requests per 15 MINUTES is not an abuse ceiling for an authenticated staff
// portal - it is a work limit, and normal use exceeded it. One composer session
// alone produced 62 preview calls (the portal fired one per keystroke, now
// debounced), and on top of the dashboard, CRM, outreach and marketing widgets
// plus their CORS preflights, a single staff member typing an email pushed the
// whole BI silo into 429s: sequences, templates, lenders and the dashboard all
// failing with "Too Many Requests" at once. That is what the log shows - 17 of
// them from one client IP in a few minutes.
//
// Burst protection is already handled by the global limiter in server.ts at
// 600/min. THIS limiter is the sustained-abuse backstop, so it needs a budget a
// working day cannot hit by accident: 2000 per 15 minutes is ~133/min, still an
// order of magnitude below what a scraper would need and well under the global
// per-minute ceiling that catches bursts.
// BI_SERVER_BLOCK_v598 - count each request ONCE.
// server.ts mounts this limiter on eight separate app.use("/api/v1/bi", ...)
// lines. A request that falls through several of those mounts before reaching
// its router was counted at every one: GET /api/v1/bi/applications cost 6 of
// the 2000 budget (the production log shows ratelimit-remaining stepping
// 1994 -> 1988 -> 1982 -> 1976). The real ceiling was ~330 requests per 15
// minutes for the whole office behind one IP, which is how 429s came back.
// The first mount a request reaches counts it; later mounts pass it through.
const biRateLimiterOnce = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyFromRequest,
});

export const biRateLimiter: RequestHandler = (req, res, next) => {
  const r = req as Request & { __biRateCounted?: boolean };
  if (r.__biRateCounted) return next();
  r.__biRateCounted = true;
  return biRateLimiterOnce(req, res, next);
};
