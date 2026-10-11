import { NextFunction, Request, Response } from "express";
import { logger } from "./logger";

// BI_SERVER_v789_NO_ERR_MESSAGE - never return err.message: it can carry SQL,
// table and column names, file paths or upstream response bodies. The client
// gets a code, a generic message for the status, and the request id to quote;
// the detail is in the server log under that id.
const GENERIC: Record<number, string> = {
  400: "Bad request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
  409: "Conflict",
  413: "Payload too large",
  415: "Unsupported media type",
  429: "Too many requests",
};

const CODE_RE = /^[a-z][a-z0-9_.:-]{0,63}$/i;

export function errorBody(err: any, status: number, requestId: unknown) {
  const rawCode = typeof err?.code === "string" ? err.code : typeof err?.type === "string" ? err.type : "";
  // Postgres SQLSTATEs (e.g. 23505) and errno strings are not client codes.
  const code = status < 500 && CODE_RE.test(rawCode) ? rawCode : status >= 500 ? "internal_error" : "request_error";
  return {
    error: code,
    message: GENERIC[status] ?? (status >= 500 ? "Internal server error" : "Request failed"),
    requestId: requestId === undefined || requestId === null ? undefined : String(requestId),
  };
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  logger.error({ err, requestId: req.id, method: req.method, path: req.originalUrl }, "Unhandled server error");
  if (res.headersSent) return;
  const status = Number(err?.status || err?.statusCode || 500);
  res.status(status >= 400 && status < 600 ? status : 500).json(errorBody(err, status, req.id));
}
