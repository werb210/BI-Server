// BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1
// + BI_SERVER_BLOCK_v406 — collapse stray leading country-code "1"s.
// Browser autofill can prepend an extra "1" (e.g. "+1" applied on top of an
// already 1-prefixed number) -> "118254511768"/"+118254511768", which Twilio
// can't route and which never matches the stored phone_e164. Canonicalize NANP
// numbers to +1XXXXXXXXXX; preserve the original international passthrough.
// BI_SERVER_PHONE_LEADING_ONE_v17
/** True when a digit string is a plausible NANP national number (NPA + NXX + 4). */
export function isPlausibleNanpNational(digits: string): boolean {
  if (digits.length !== 10) return false;
  const npa = digits.slice(0, 3);
  const nxx = digits.slice(3, 6);
  if (!/^[2-9]/.test(npa) || !/^[2-9]/.test(nxx)) return false;
  if (npa.endsWith("11") || nxx.endsWith("11")) return false;
  return true;
}

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
  if (nanp.length === 11 && nanp.startsWith("1")) {
    // BI_SERVER_PHONE_LEADING_ONE_v17 - validate the national part rather than
    // trusting the length.
    return isPlausibleNanpNational(nanp.slice(1)) ? `+${nanp}` : null;
  }

  // BI_SERVER_PHONE_LEADING_ONE_v17
  // The comment above already states the rule - NANP area codes never start
  // with 1 - but it was only applied to the collapse loop, not here. Ten digits
  // beginning with 1 is someone typing the country code and dropping a digit
  // ("1 423 205 619"), and prepending +1 turned it into "+11423205619": a
  // well-formed string Twilio cannot route. Reject instead of manufacturing it.
  if (!hasPlus && nanp.length === 10) {
    return isPlausibleNanpNational(nanp) ? `+1${nanp}` : null;
  }

  // International E.164 passthrough — only when explicitly +-prefixed.
  // A +1 number must carry a full 10-digit national part; "+1 423-205-619" used
  // to slip through here as "+1423205619" because it is 10 digits and 10 is
  // inside the 8-15 window.
  if (hasPlus) {
    if (digits.startsWith("1")) {
      return isPlausibleNanpNational(digits.slice(1)) ? `+${digits}` : null;
    }
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  return null;
}
