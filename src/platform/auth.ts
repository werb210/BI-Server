import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "./env";

const authSecret = process.env.BI_STAFF_JWT_SECRET || env.JWT_SECRET;

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
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ status: "error", error: "Invalid token" });
  }
}
