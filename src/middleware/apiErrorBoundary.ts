// BI_SERVER_BLOCK_v212_SUBMIT_GUARDS_v1
import type { Request, Response, NextFunction } from "express";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function apiErrorBoundary(err: any, req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) return next(err);

  // eslint-disable-next-line no-console
  console.error("[apiErrorBoundary]", req.method, req.path, err?.code || "", err?.message || err);

  if (res.headersSent) return;

  const origin = req.header("origin");
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }

  const status = (err && (err.status || err.statusCode)) || 500;
  res.status(status).json({
    error: err?.code || "internal_error",
    message: err?.message || "Internal server error",
  });
}
