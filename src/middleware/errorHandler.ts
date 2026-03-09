import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  logger.error(err);

  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error"
  });
}
