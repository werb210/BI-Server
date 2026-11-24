// BI_SERVER_BLOCK_v212_SUBMIT_GUARDS_v1
import type { Request, Response, NextFunction } from "express";
import { setCorsHeadersIfAllowed } from "../platform/corsOrigins";

const API_TIMEOUT_MS = 10000;
// BI_SERVER_LONG_ROUTES_v1 - bulk list imports and exports write or read thousands of rows; 10 s cut them off with a
// 503 while the work finished anyway (and the handler then failed with "headers already sent").
const LONG_ROUTES: Array<[RegExp, number]> = [
  [/^\/api\/v1\/bi\/crm\/list-import/, 180000],
  [/^\/api\/v1\/bi\/crm\/directory-export/, 60000],
];
export function timeoutFor(path: string): number {
  for (const [re, ms] of LONG_ROUTES) if (re.test(path)) return ms;
  return API_TIMEOUT_MS;
}

export function apiTimeoutGuard(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) return next();

  const ms = timeoutFor(req.path);
  const timer = setTimeout(() => {
    if (res.headersSent) return;
    // BI_SERVER_v789_CORS - only an allowed Origin is echoed back.
    setCorsHeadersIfAllowed(req.header("origin"), res);
    res.status(503).json({
      error: "server_timeout",
      message: `Request exceeded ${ms}ms server timeout`,
      requestId: req.id,
    });
  }, ms);

  const clear = () => clearTimeout(timer);
  res.on("finish", clear);
  res.on("close", clear);
  next();
}
