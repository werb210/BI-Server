import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

export const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.string().default("3001"),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string(),
  SERVICE_NAME: z.string().default("bi-server"),
  LOG_LEVEL: z.string().default("info"),
  BI_WEBSITE_ORIGIN: z.string().default("http://localhost:5173"),
  API_BASE_URL: z.string().default("https://server.boreal.financial"),
  CORS_ORIGIN: z.string(),
  OPENAI_API_KEY: z.string(),
  TWILIO_ACCOUNT_SID: z.string(),
  TWILIO_AUTH_TOKEN: z.string(),
  TWILIO_FROM: z.string(),
  TWILIO_VERIFY_SERVICE_SID: z.string(),
  ALERT_SMS_TO: z.string(),
  SENDGRID_API_KEY: z.string().default(""),
  SENDGRID_FROM: z.string().default(""),
  CRM_WEBHOOK_URL: z.string().optional(),
  ADMIN_JWT_SECRET: z.string(),
  PURGE_BUFFER_DAYS: z.string().default("30"),
  PGI_API_KEY: z.string().regex(/^pk_(test|live)_/),
  PGI_WEBHOOK_SECRET: z.string().regex(/^whsec_/),
});

export const env = envSchema.parse(process.env);
