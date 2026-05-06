import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "./env";

const authSecret = process.env.BI_STAFF_JWT_SECRET || env.JWT_SECRET || "dev-missing-jwt-secret";

export function signStaffToken(payload: { staffUserId: string; role: string; phone?: string; userType?: string }) {
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
    // BI_SERVER_BLOCK_v157_BF_JWT_INTEROP_AND_CRM_FIX_v1
    // BF-Server signs JWTs with `sub` (the user id). BI-Server
    // handlers read `staffUserId`. Without this normalizer, every
    // BF-portal staff action against BI-Server lands with no user
    // attribution (reviewed_by=NULL, actor_user_id=NULL, etc.).
    if (decoded && typeof decoded === "object") {
      const d = decoded as Record<string, unknown>;
      if (!d.staffUserId && typeof d.sub === "string") {
        d.staffUserId = d.sub;
      }
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ status: "error", error: "Invalid token" });
  }
}
