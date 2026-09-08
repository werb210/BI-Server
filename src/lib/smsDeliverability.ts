// BI_SERVER_BLOCK_v262_SMS_DELIVERABILITY_v1
// Ported from BF-Server after the 2026-08-26 incident: 400,145 messages were
// billed as Failed Message Processing Fees because nothing classified a
// permanent rejection and nothing checked the destination before sending.
// bi-server has no retry layer today, so a bad number costs one rejection
// rather than thousands — but the guard belongs here before one is added.
export const PERMANENT_SMS_ERROR_CODES = [
  21602, // message body is required — an empty body is empty however often it is sent
  21211, 21214, 21408, 21610, 21612, 21614, 30003, 30005, 30006,
] as const;

export function twilioErrorCode(err: unknown): number {
  const raw = (err as { code?: unknown; status?: unknown } | null)?.code
    ?? (err as { code?: unknown; status?: unknown } | null)?.status;
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function isPermanentSmsFailure(err: unknown): boolean {
  return (PERMANENT_SMS_ERROR_CODES as readonly number[]).includes(twilioErrorCode(err));
}

/** True when the number is provably unable to receive SMS. */
export function isUndeliverableNumber(raw: unknown): boolean {
  const digits = String(raw ?? "").replace(/[^0-9]/g, "");
  if (digits.length < 10) return true;
  if (/^(.)\1+$/.test(digits)) return true;
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return digits.length < 10;
  const area = national.slice(0, 3);
  const exchange = national.slice(3, 6);
  if (area[0] < "2" || exchange[0] < "2") return true;
  if (exchange === "555") return true;
  if (national === "1234567890" || national === "2345678901") return true;
  return false;
}

/** An empty body is the single most expensive send: Twilio bills the rejection. */
export function isSendableBody(body: unknown): boolean {
  return typeof body === "string" && body.trim().length > 0;
}
