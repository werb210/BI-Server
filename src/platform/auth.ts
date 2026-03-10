import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "./env";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;

  if (!auth) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  const token = auth.replace("Bearer ", "");

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);

    req.user = decoded;

    next();
  } catch {
    return res.status(401).json({
      success: false,
      error: "Invalid token"
    });
  }
}
