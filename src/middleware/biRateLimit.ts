import rateLimit from "express-rate-limit";
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
export const biRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyFromRequest,
});
