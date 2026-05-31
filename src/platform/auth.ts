import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "./env";

const authSecret = process.env.BI_STAFF_JWT_SECRET || env.JWT_SECRET || "dev-missing-jwt-secret";

export function signStaffToken(payload: { staffUserId: string; role: string; phone?: string; userType?: string; capabilities?: string[] }) {
  return jwt.sign(payload, authSecret, { expiresIn: "8h" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;

  if (!auth) {
    return res.status(401).json({ status: "error", error: "Unauthorized" });
  }

  const token = auth.replace("Bearer ", "");

  try {
    const decoded = jwt.verify(token, authSecret);
    // BI_SERVER_BLOCK_v176_AUTH_SUB_NORMALIZER_v1
    // BF-Server JWTs sign 'sub' (standard JWT). BI code reads
    // req.user.staffUserId. Without normalization, every BF-portal
    // action against BI loses user attribution. Mirror sub -> staffUserId
    // when only the standard claim is present.
    if (decoded && typeof decoded === "object") {
      const obj = decoded as Record<string, unknown>;
      if (typeof obj.sub === "string" && !obj.staffUserId) {
        obj.staffUserId = obj.sub;
      }
      // Also normalize role to lowercase so cross-silo role checks
      // (e.g. v160 admin gate) don't break on 'Admin' vs 'admin'.
      if (typeof obj.role === "string") {
        obj.role = obj.role.toLowerCase();
      }
    }
    req.user = decoded;
    // BI_SERVER_BLOCK_v411_STAFF_CAPS_FROM_ROLE_v1 — BF-Server staff JWTs carry
    // BF capability strings, not BI's marketing:* set, so capability-gated BI
    // CRM writes (bulk-tag / bulk-delete) returned 403 for valid staff. Grant
    // the BI capability set to any authenticated staff/admin based on role.
    try {
      const u = req.user as Record<string, unknown> | undefined;
      const role = typeof u?.role === "string" ? u.role : "";
      if (u && (role === "admin" || role === "owner" || role === "staff" || role === "marketing")) {
        const existing = Array.isArray(u.capabilities) ? (u.capabilities as string[]) : [];
        const biCaps = role === "admin" || role === "owner"
          ? ["crm:read", "marketing:lists", "marketing:outreach", "marketing:admin"]
          : ["crm:read", "marketing:lists", "marketing:outreach"];
        u.capabilities = Array.from(new Set([...existing, ...biCaps]));
      }
    } catch { /* non-fatal: leave capabilities unchanged */ }
    next();
  } catch {
    return res.status(401).json({ status: "error", error: "Invalid token" });
  }
}
