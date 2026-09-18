import pinoHttp from "pino-http";
import { logger } from "../platform/logger";

export const httpLogger = pinoHttp({
  logger,
  autoLogging: true,
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
