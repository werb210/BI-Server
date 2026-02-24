import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: process.env.PORT || "8080",
  DATABASE_URL: requireEnv("DATABASE_URL"),
  JWT_SECRET: requireEnv("JWT_SECRET"),
  CORS_ORIGIN: requireEnv("CORS_ORIGIN"),
  OPENAI_API_KEY: requireEnv("OPENAI_API_KEY"),
  TWILIO_ACCOUNT_SID: requireEnv("TWILIO_ACCOUNT_SID"),
  TWILIO_AUTH_TOKEN: requireEnv("TWILIO_AUTH_TOKEN"),
  TWILIO_FROM: requireEnv("TWILIO_FROM"),
  TWILIO_VERIFY_SERVICE_SID: requireEnv("TWILIO_VERIFY_SERVICE_SID"),
  ALERT_SMS_TO: requireEnv("ALERT_SMS_TO"),
  SENDGRID_API_KEY: requireEnv("SENDGRID_API_KEY"),
  SENDGRID_FROM: requireEnv("SENDGRID_FROM"),
  PURGE_BUFFER_DAYS: Number(process.env.PURGE_BUFFER_DAYS || "30")
};
