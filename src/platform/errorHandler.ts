import { NextFunction, Request, Response } from "express";
import { logger } from "./logger";

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  logger.error({ err, requestId: req.id }, "Unhandled server error");

  res.status(err.status || 500).json({
    success: false,
    error: err.message || "Internal Server Error",
    requestId: req.id
  });
}
