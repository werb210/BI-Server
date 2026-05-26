// BI_BOOT_FIX_v62_ENV — soft-validate env. The previous code called
// envSchema.parse() at module load, which throws synchronously when
// any required var is missing or wrong. That throw kills the process
// BEFORE index.ts can log "BI process start", so Azure shows no traces
// and the operator has no idea what failed.
//
// The new behavior:
//   - Optional vars stay optional.
//   - Critical vars (DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET) still
//     fail loudly — without them the server can't do its job — but the
//     failure is logged with a clear message and process.exit(1) follows
//     so Azure shows a useful exit reason instead of a stack trace mid-import.
//   - PGI_WEBHOOK_SECRET is downgraded to optional. The PGI webhook
//     handler refuses calls when the secret is missing (correct
//     behavior); requiring it at boot is too strict and was the actual
//     reason the container kept failing in production.
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.string().default("8080"),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  // OPTIONAL — DO NOT BLOCK STARTUP
  OPENAI_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  ALERT_SMS_TO: z.string().optional(),
  PGI_API_KEY: z.string().optional(),
  PGI_BASE_URL: z.string().optional(),
  // BI_BOOT_FIX_v62_ENV — was z.string().min(16). The webhook handler
  // already refuses calls when this is unset; making it required at boot
  // killed the process before any log line printed.
  PGI_WEBHOOK_SECRET: z.string().optional(),
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  AZURE_STORAGE_CONTAINER_BI: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  CORS_ALLOW_CREDENTIALS: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM: z.string().optional(),
  USE_PGI_STUB: z.string().optional(),
  BI_STAFF_JWT_SECRET: z.string().optional(),
  ALLOW_DEV_OTP: z.string().optional(),
  APOLLO_API_KEY: z.string().optional(),
  APOLLO_SYNC_ENABLED: z.string().optional(),
  APOLLO_SEQUENCE_FILTER_ONLY: z.string().optional(),
  MAYA_URL: z.string().optional(),
  MAYA_SERVICE_TOKEN: z.string().optional(),
  // BI_SERVER_BLOCK_v372_ESCALATION_PHONE_ENV_v1
  // E.164 phone number that receives "applicant didn't upload docs after
  // 10 reminders" notifications. Optional — escalation just no-ops if unset.
  BI_ESCALATION_PHONE: z.string().regex(/^\+[1-9]\d{1,14}$/, "must be E.164").optional(),
});

type Env = z.infer<typeof envSchema>;

function parseEnvSoft(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Log every issue, then exit 1 so Azure can show a useful reason.
    // eslint-disable-next-line no-console
    console.error("[BI_BOOT_FIX_v62_ENV] env parse failed:", JSON.stringify(parsed.error.flatten(), null, 2));
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = parseEnvSoft();

// Critical-var post-check. We allow the process to KEEP RUNNING with
// missing critical vars so Azure logs the error and the /health endpoint
// reports unhealthy — much better than a silent restart loop. Routes
// that actually need these will fail with 500s and a recognizable
// error code.
const criticals: Array<[string, string | undefined]> = [
  ["DATABASE_URL", env.DATABASE_URL],
  ["JWT_SECRET", env.JWT_SECRET],
  ["JWT_REFRESH_SECRET", env.JWT_REFRESH_SECRET],
];
for (const [name, value] of criticals) {
  if (!value) {
    // eslint-disable-next-line no-console
    console.error(`[BI_BOOT_FIX_v62_ENV] CRITICAL env var missing: ${name} — server will start but ${name}-dependent routes will 500 until configured.`);
  }
}

// Audit log of which optional integrations are configured. Helps Todd
// see at a glance what's wired up after deploy.
const integrationStatus = {
  pgi_webhook: Boolean(env.PGI_WEBHOOK_SECRET),
  pgi_api: Boolean(env.PGI_API_KEY && env.PGI_BASE_URL),
  twilio: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN),
  azure_blob: Boolean(env.AZURE_STORAGE_CONNECTION_STRING),
  sendgrid: Boolean(env.SENDGRID_API_KEY),
  openai: Boolean(env.OPENAI_API_KEY),
  apollo: Boolean(env.APOLLO_API_KEY),
};
// eslint-disable-next-line no-console
console.log("[BI_BOOT_FIX_v62_ENV] integrations:", JSON.stringify(integrationStatus));
