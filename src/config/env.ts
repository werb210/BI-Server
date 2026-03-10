import { env } from "../platform/env";

export const ENV = {
  ...env,
  PORT: env.PORT,
  PURGE_BUFFER_DAYS: Number(env.PURGE_BUFFER_DAYS)
};
