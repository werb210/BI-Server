// BI_SERVER_BLOCK_v212_SUBMIT_GUARDS_v1
// BI_SERVER_v789_NO_ERR_MESSAGE / v789_CORS - the response carries a code, a
// generic message and the request id; err.message is logged, never returned.
// CORS headers are set only for an allowed Origin.
import type { Request, Response, NextFunction } from "express";
import { setCorsHeadersIfAllowed } from "../platform/corsOrigins";
import { errorBody } from "../platform/errorHandler";
import { logger } from "../platform/logger";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function apiErrorBoundary(err: any, req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) return next(err);

  logger.error({ err, requestId: req.id, method: req.method, path: req.path }, "apiErrorBoundary");

  if (res.headersSent) return;

  setCorsHeadersIfAllowed(req.header("origin"), res);

  const status = Number((err && (err.status || err.statusCode)) || 500);
  res.status(status).json(errorBody(err, status, req.id));
}
