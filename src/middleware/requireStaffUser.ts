// BI_SERVER_v789_STAFF_ONLY - requireAuth accepts staff AND service tokens.
// Routes that only a human staff member may call put this after requireAuth:
// a service token (kind "service", or BF-Server's { sub: "bf-server",
// scope: "bi:service" }) gets 403.
import type { NextFunction, Request, Response } from "express";
import { isServiceClaims } from "../platform/serviceTokens";

export function requireStaffUser(req: Request, res: Response, next: NextFunction) {
  const user = (req as unknown as { user?: unknown }).user;
  if (!user) return res.status(401).json({ status: "error", error: "Unauthorized" });
  if (isServiceClaims(user)) return res.status(403).json({ status: "error", error: "staff_only" });
  return next();
}
