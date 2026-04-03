import { Request, Response, NextFunction } from "express";
import { badRequest } from "../utils/apiResponse";

/**
 * Ensures BI routes are never mounted outside /api/v1/bi
 */
export function enforceBIPrefix(req: Request, res: Response, next: NextFunction) {
  if (!req.originalUrl.startsWith("/api/v1/bi")) {
    return badRequest(res, "BI route isolation violation");
  }
  next();
}
