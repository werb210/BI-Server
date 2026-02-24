import { Request, Response, NextFunction } from "express";

/**
 * Ensures BI routes are never mounted outside /api/bi
 */
export function enforceBIPrefix(req: Request, res: Response, next: NextFunction) {
  if (!req.originalUrl.startsWith("/api/bi")) {
    return res.status(403).json({ error: "BI route isolation violation" });
  }
  next();
}
