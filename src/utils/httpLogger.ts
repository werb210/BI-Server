import pinoHttp from "pino-http";
import { logger } from "../platform/logger";

export const httpLogger = pinoHttp({
  logger,
  autoLogging: true,
  customProps: (req) => ({ requestId: req.id })
});
