import pinoHttp from "pino-http";
import { logger } from "../platform/logger";

// BI_SERVER_BLOCK_v598 - Azure's HealthCheck (every minute) and AlwaysOn (every
// five) probes wrote ~1,700 full-header request lines a day, around 95% of the
// log, so real traffic and errors could not be found. Successful probes are now
// silent; a failing probe (4xx/5xx or an error) is still logged.
const PROBE_AGENT = /^(HealthCheck|AlwaysOn|ReadyForRequest)/i;
export function httpLogLevel(req: any, res: any, err?: unknown): "silent" | "info" | "error" {
  if (err || (res?.statusCode ?? 0) >= 500) return "error";
  const path = String(req?.url ?? "").split("?")[0];
  const agent = String(req?.headers?.["user-agent"] ?? "");
  if ((path === "/health" || path === "/") && PROBE_AGENT.test(agent) && (res?.statusCode ?? 0) < 400) return "silent";
  return "info";
}

export const httpLogger = pinoHttp({
  logger,
  autoLogging: true,
  customLogLevel: httpLogLevel, // BI_SERVER_BLOCK_v598
  customProps: (req) => ({ requestId: req.id }),
  // BI_SERVER_REDACT_AUTH_LOGS_v354 - every request line wrote the caller's full
  // bearer token (and cookies / the backend service token) into the App Service
  // log stream, where anyone with log access could replay it for its lifetime.
  serializers: {
    req: (req: any) => {
      const headers = { ...(req?.headers ?? {}) };
      for (const key of ["authorization", "cookie", "x-backend-token"]) {
        if (headers[key] !== undefined) headers[key] = "[redacted]";
      }
      return { ...req, headers };
    },
  },
});
