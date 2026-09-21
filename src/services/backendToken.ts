// BI_SERVER_BACKEND_TOKEN_CHECK_v372
// On 2026-09-18 every sequence email failed with "Cannot convert argument to a
// ByteString ... character at index 12 has a value of 8212": the token in
// BACKEND_SERVICE_TOKEN contained an em dash (U+2014), which cannot go in an
// HTTP header. The next minute it was a different value BF-Server rejected
// (401 invalid_backend_token). Both showed up only as per-step failures.
// Check the token before sending and say plainly what is wrong with it.
export function backendTokenProblem(token: string): string | null {
  if (!token) return "BACKEND_SERVICE_TOKEN is not set on BI-Server";
  if (!/^[\x21-\x7e]+$/.test(token)) {
    return "BACKEND_SERVICE_TOKEN on BI-Server contains a character that cannot be sent in a header (a space, smart quote or dash pasted in) - re-copy it from BF-Server";
  }
  return null;
}

export const MAX_SEND_ATTEMPTS = 3;
export const RETRY_DELAY_MINUTES = 15;

/** A failed send is retried until it has failed MAX_SEND_ATTEMPTS times on that step. */
export function shouldRetrySend(failuresOnThisStep: number): boolean {
  return failuresOnThisStep < MAX_SEND_ATTEMPTS;
}
