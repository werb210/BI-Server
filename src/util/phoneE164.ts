// BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1
// + BI_SERVER_BLOCK_v406 — collapse stray leading country-code "1"s.
// Browser autofill can prepend an extra "1" (e.g. "+1" applied on top of an
// already 1-prefixed number) -> "118254511768"/"+118254511768", which Twilio
// can't route and which never matches the stored phone_e164. Canonicalize NANP
// numbers to +1XXXXXXXXXX; preserve the original international passthrough.
export function normalizeE164(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;

  // Collapse extra leading 1s beyond a valid 11-digit NANP number. (NANP area
  // codes never start with 1, so a valid 10-digit national number is never
  // over-stripped.)
  let nanp = digits;
  while (nanp.length > 11 && nanp.startsWith("1")) nanp = nanp.slice(1);
  if (nanp.length === 11 && nanp.startsWith("1")) return `+${nanp}`;
  if (!hasPlus && nanp.length === 10) return `+1${nanp}`;

  // International E.164 passthrough — only when explicitly +-prefixed.
  if (hasPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  return null;
}
