// BI_SERVER_v789_LENDER_ACTIVE - a lender token (or API key) only works while
// its bi_lenders row is active and, when the token names a login contact, that
// bi_lender_login_contacts row is active too. OTP verify mints user_id (SMS)
// or contactId (email); both are bi_lender_login_contacts.id.
//
// The answer is cached in memory for 30 seconds per (lender id, contact id) so
// a busy lender does not add a query to every request. A deactivation therefore
// takes effect within 30 seconds.
import { pool } from "../db";
import { logHiddenError } from "../platform/safeError";

export type LenderActiveState = "active" | "lender_inactive" | "contact_inactive";

export const LENDER_ACTIVE_TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;

type Entry = { state: LenderActiveState; expiresAt: number };
const cache = new Map<string, Entry>();

function cacheKey(lenderId: string, contactId: string | null): string {
  return `${lenderId}|${contactId ?? ""}`;
}

/**
 * Throws when the database cannot answer (callers reply 503); the error is
 * never cached.
 */
export async function lenderActiveState(
  lenderId: string,
  contactId: string | null | undefined,
  now: number = Date.now(),
): Promise<LenderActiveState> {
  const contact = contactId ? String(contactId) : null;
  const key = cacheKey(String(lenderId), contact);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.state;

  const r = await pool.query<{ lender_active: boolean | null; contact_active: boolean | null }>(
    `SELECT l.is_active AS lender_active, c.is_active AS contact_active
       FROM bi_lenders l
       LEFT JOIN bi_lender_login_contacts c
              ON c.lender_id = l.id AND c.id::text = $2::text
      WHERE l.id::text = $1::text
      LIMIT 1`,
    [String(lenderId), contact],
  );
  const row = r.rows[0];
  let state: LenderActiveState;
  if (!row || row.lender_active !== true) state = "lender_inactive";
  else if (contact && row.contact_active !== true) state = "contact_inactive";
  else state = "active";

  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { state, expiresAt: now + LENDER_ACTIVE_TTL_MS });
  return state;
}

/** Contact id carried by a lender token (SMS verify: user_id, email verify: contactId). */
export function lenderContactIdFromClaims(claims: Record<string, unknown> | null | undefined): string | null {
  if (!claims) return null;
  const v = claims.user_id ?? claims.contactId;
  return v === undefined || v === null || v === "" ? null : String(v);
}

/** Test hook. */
export function resetLenderActiveCache(): void {
  cache.clear();
}

type ResLike = { status: (code: number) => { json: (body: unknown) => unknown } };
type ReqLike = { id?: unknown; method?: string; originalUrl?: string };

/**
 * Express helper: replies and returns false when the lender (or its contact)
 * is inactive, or 503 when the check itself fails. Returns true to continue.
 */
export async function ensureLenderActive(
  req: ReqLike,
  res: ResLike,
  lenderId: string,
  contactId: string | null | undefined,
): Promise<boolean> {
  let state: LenderActiveState;
  try {
    state = await lenderActiveState(lenderId, contactId);
  } catch (err) {
    res.status(503).json({ error: "lender_check_unavailable", requestId: logHiddenError(req, err, "lender_check_unavailable") });
    return false;
  }
  if (state === "active") return true;
  res.status(403).json({ error: state });
  return false;
}
