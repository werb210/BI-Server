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
  PGI_WEBHOOK_SECRET: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  CORS_ALLOW_CREDENTIALS: z.string().optional()
});
export const env = envSchema.parse(process.env);
