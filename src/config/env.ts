import { env } from "../platform/env";

export const ENV = {
  ...env,
  PORT: env.PORT,
  PURGE_BUFFER_DAYS: Number(process.env.PURGE_BUFFER_DAYS || "30"),
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
  SENDGRID_FROM: process.env.SENDGRID_FROM
};
