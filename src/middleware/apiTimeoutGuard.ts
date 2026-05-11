// BI_SERVER_BLOCK_v212_SUBMIT_GUARDS_v1
import type { Request, Response, NextFunction } from "express";

const API_TIMEOUT_MS = 10000;

export function apiTimeoutGuard(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) return next();

  const timer = setTimeout(() => {
    if (res.headersSent) return;
    const origin = req.header("origin");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    res.status(503).json({
      error: "server_timeout",
      message: `Request exceeded ${API_TIMEOUT_MS}ms server timeout`,
      path: req.path,
    });
  }, API_TIMEOUT_MS);

  const clear = () => clearTimeout(timer);
  res.on("finish", clear);
  res.on("close", clear);
  next();
}
