import { NextFunction, Request, Response } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.headers["x-admin-key"] !== process.env.JWT_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}
