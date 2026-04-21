import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.string().default("production"),

  PORT: z.string().optional(),

  DATABASE_URL: z.string(),

  JWT_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string().optional(),

  // CORS
  CORS_ALLOWED_ORIGINS: z.string(),

  // OPTIONAL SERVICES (DO NOT BLOCK STARTUP)
  OPENAI_API_KEY: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),

  ALERT_SMS_TO: z.string().optional(),

  ADMIN_JWT_SECRET: z.string().optional(),

  PGI_API_KEY: z.string().optional(),
  PGI_WEBHOOK_SECRET: z.string().optional(),

  // Backwards-compatible optionals
  LOG_LEVEL: z.string().optional(),
  PURGE_BUFFER_DAYS: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM: z.string().optional(),
  CRM_WEBHOOK_URL: z.string().optional(),
  BI_WEBSITE_ORIGIN: z.string().optional(),
});

export const env = envSchema.parse(process.env);
