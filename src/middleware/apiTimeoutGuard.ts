// BI_SERVER_BLOCK_v212_SUBMIT_GUARDS_v1
import type { Request, Response, NextFunction } from "express";
import { setCorsHeadersIfAllowed } from "../platform/corsOrigins";

const API_TIMEOUT_MS = 10000;

export function apiTimeoutGuard(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) return next();

  const timer = setTimeout(() => {
    if (res.headersSent) return;
    // BI_SERVER_v789_CORS - only an allowed Origin is echoed back.
    setCorsHeadersIfAllowed(req.header("origin"), res);
    res.status(503).json({
      error: "server_timeout",
      message: `Request exceeded ${API_TIMEOUT_MS}ms server timeout`,
      requestId: req.id,
    });
  }, API_TIMEOUT_MS);

  const clear = () => clearTimeout(timer);
  res.on("finish", clear);
  res.on("close", clear);
  next();
}
