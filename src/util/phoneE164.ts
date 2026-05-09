// BI_SERVER_BLOCK_v208_OTP_PHONE_NORMALIZE_v1
// Twilio Verify rejects anything not strictly E.164 (+<cc><number>). Live
// failure observed 2026-05-09T23:47:58Z: client sent "5878881837", Twilio
// returned error 60200 "Invalid parameter `To`". Never trust the client.
//
// Rules (CA/US-default for launch):
//   - Strip everything except digits and a leading '+'.
//   - If starts with '+' and 11-15 total digits → keep as-is.
//   - 10 digits → prepend '+1'.
//   - 11 digits starting with '1' → prepend '+'.
//   - Anything else → null (caller returns 400).
export function normalizeE164(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Preserve leading + then strip non-digits.
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;

  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
