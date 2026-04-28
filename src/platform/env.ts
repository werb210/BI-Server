import { z } from 'zod';
const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.string().default('8080'),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),
  // OPTIONAL — DO NOT BLOCK STARTUP
  OPENAI_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  ALERT_SMS_TO: z.string().optional(),
  PGI_API_KEY: z.string().optional(),
  PGI_BASE_URL: z.string().optional(),
  // BI_HARDENING_v44 — PGI_WEBHOOK_SECRET is now REQUIRED. Server refuses to
  // start without it so signature verification cannot silently no-op.
  PGI_WEBHOOK_SECRET: z.string().min(16, "PGI_WEBHOOK_SECRET must be at least 16 chars"),
  // BI_HARDENING_v44 — Azure Blob is required in production. In test/dev the
  // storage factory falls back to LocalBackend if absent.
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  AZURE_STORAGE_CONTAINER_BI: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  CORS_ALLOW_CREDENTIALS: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM: z.string().optional(),
  USE_PGI_STUB: z.string().optional(),
  BI_STAFF_JWT_SECRET: z.string().optional(),
  ALLOW_DEV_OTP: z.string().optional()
});
export const env = envSchema.parse(process.env);
