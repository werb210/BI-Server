import pinoHttp from "pino-http";
import { logger } from "./logger";

export const httpLogger = pinoHttp({
  logger,
  autoLogging: true
});
