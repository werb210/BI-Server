import pino from "pino";
import { env } from "./env";

export const logger = pino({
  name: "bi-server",
  level: process.env.LOG_LEVEL || "info",
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty"
        }
      : undefined
});
