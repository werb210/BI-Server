export function validateEnv() {
  const required = [
    "DATABASE_URL",
    "JWT_SECRET",
    "ADMIN_JWT_SECRET",
    "CORS_ORIGIN",
    "OPENAI_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER"
  ];

  const missing = required.filter(v => !process.env[v]);

  if (missing.length > 0) {
    throw new Error("Missing environment variables: " + missing.join(", "));
  }
}
