import { NextFunction, Request, Response } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as Request & { user?: { role?: string } }).user;

  if (user?.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}
