// BI_SERVER_v784_JWT_SECRET
// Single place every route reads the JWT signing secret from. There is no
// fallback literal: a missing JWT_SECRET used to fall back to a well-known
// string, which let anyone mint applicant, lender, referrer or staff tokens.
// index.ts calls assertJwtSecretAtStartup() so production refuses to boot
// without it; routes read it lazily through getJwtSecret().

export class JwtSecretMissingError extends Error {
  constructor() {
    super("JWT_SECRET is not configured");
    this.name = "JwtSecretMissingError";
  }
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new JwtSecretMissingError();
  return secret;
}

// BI_SERVER_v789_TOKENS - staff tokens are always signed with JWT_SECRET and
// JWT_SECRET is always accepted. BI_STAFF_JWT_SECRET, when set, is only an
// additional accepted verification secret (it never replaces JWT_SECRET).
export function getStaffJwtSecret(): string {
  return getJwtSecret();
}

export function getStaffVerifySecrets(): string[] {
  const out = [getJwtSecret()];
  const extra = process.env.BI_STAFF_JWT_SECRET;
  if (extra && extra !== out[0]) out.push(extra);
  return out;
}

export function assertJwtSecretAtStartup(): void {
  if (process.env.JWT_SECRET) return;
  if (process.env.NODE_ENV === "test") return;
  // eslint-disable-next-line no-console
  console.error("[BI_SERVER_v784] FATAL: JWT_SECRET is not set. Refusing to start.");
  process.exit(1);
}
