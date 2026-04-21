import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "./env";
import { badRequest } from "../utils/apiResponse";

const authSecret = process.env.BI_STAFF_JWT_SECRET || env.JWT_SECRET;

export function signStaffToken(payload: { staffUserId: string; role: string }) {
  return jwt.sign(payload, authSecret, { expiresIn: "8h" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;

  if (!auth) {
    return badRequest(res, "Unauthorized");
  }

  const token = auth.replace("Bearer ", "");

  try {
    const decoded = jwt.verify(token, authSecret);
    req.user = decoded;
    next();
  } catch {
    return badRequest(res, "Invalid token");
  }
}
