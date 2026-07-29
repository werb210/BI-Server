import rateLimit from "express-rate-limit";
import { rateLimitKeyFromRequest } from "./rateLimitKey";

export const biRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyFromRequest,
});
