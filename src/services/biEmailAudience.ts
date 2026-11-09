// BI_AUDIENCE_TAG_CASE_v33
// The tag filter compared with the array-overlap operator:
//
//   AND ($1::text[] IS NULL OR COALESCE(c.tags, '{}') && $1)
//
// && is exact and case-sensitive, while /email/segments lists the picker's tags
// as lower(trim(tag)) and audienceParams lowercased them again on the way back
// in. So a stored tag of 'Lender' could never match the 'lender' the composer
// sent, and nothing normalises tags on write.
//
// The include side failed safe: no overlap, no recipients, a visible zero.
// The exclude side failed DANGEROUS. It is a negation, so NOT (tags && $2) is
// true for every row when nothing overlaps - an exclusion the sender chose
// deliberately was silently discarded and those contacts were mailed anyway,
// while the approved count still looked entirely plausible.
//
// Compare on lower(trim(...)) on both sides rather than assuming the stored
// data is already lowercase. Count and send share this one predicate, so the
// number approved is the number that receives.
// BI_SERVER_SKIP_TEXTED_v1 - skipTextedDays: leave out anyone sent a marketing text (a sequence SMS) in the last N days.
export interface AudienceFilter { includeTags?: string[]; excludeTags?: string[]; skipTextedDays?: number | null }

// BI_SERVER_EMAIL_ALL_CONTACTS_v1 - Todd's rule (Nov 9, same as BF-Server v917): every CRM contact with an email
// address gets campaign email. Only unsubscribed / suppressed addresses are left out; recorded consent is no longer a gate.
const eligible = `
  c.email IS NOT NULL AND position('@' in c.email) > 1
  AND ($1::text[] IS NULL OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(c.tags, '{}')) AS t
    WHERE lower(trim(t)) = ANY($1)))
  AND ($2::text[] IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(COALESCE(c.tags, '{}')) AS t
    WHERE lower(trim(t)) = ANY($2)))
  AND NOT EXISTS (
    SELECT 1 FROM bi_suppressions s
    WHERE lower(s.email) = lower(c.email) AND s.channel IN ('email', 'all')
  )
  AND ($3::int IS NULL OR NOT EXISTS (
    SELECT 1 FROM bi_sequence_events e JOIN bi_sequence_enrollments en ON en.id = e.enrollment_id
    WHERE en.contact_id = c.id AND e.event_type = 'sent' AND e.channel = 'sms'
      AND e.created_at > now() - ($3::int * interval '1 day')))`;

export function skipTextedDaysOf(v: unknown): number | null {
  if (v === true || v === "true" || v === "1") return 7;
  const n = Number(v);
  return typeof v === "number" && Number.isInteger(n) && n >= 1 && n <= 90 ? n : null;
}

export function audienceParams(filter: AudienceFilter): [string[] | null, string[] | null, number | null] {
  // BI_AUDIENCE_TAG_CASE_v33 - trim as well as lower, and drop blanks. A tag
  // picked as " Lender " must match a stored "lender", and an all-blank list
  // must become NULL rather than an array that can never match anything.
  const tags = (value?: string[]) => {
    const cleaned = (value ?? []).map((tag) => String(tag ?? "").trim().toLowerCase()).filter(Boolean);
    return cleaned.length ? [...new Set(cleaned)] : null;
  };
  return [tags(filter.includeTags), tags(filter.excludeTags), skipTextedDaysOf(filter.skipTextedDays)];
}
export function buildAudienceCountSql(): string { return `SELECT count(*)::int AS count FROM bi_contacts c WHERE ${eligible}`; }
export function buildAudienceSelectSql(): string {
  return `SELECT c.id, c.email, c.full_name, COALESCE(co.operating_name, co.legal_name, '') AS company, c.tags
    FROM bi_contacts c LEFT JOIN bi_companies co ON co.id = c.company_id WHERE ${eligible} ORDER BY c.id`;
}
export function buildAudienceBreakdownSql(): string {
  return `SELECT
    count(*) FILTER (WHERE c.email IS NOT NULL AND position('@' in c.email) > 1)::int AS with_email,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM bi_suppressions s WHERE lower(s.email)=lower(c.email) AND s.channel IN ('email','all')))::int AS suppressed,
    count(*) FILTER (WHERE c.marketing_consent_basis IS NULL)::int AS no_consent_recorded,
    count(*) FILTER (WHERE c.marketing_consent_expires_at IS NOT NULL AND c.marketing_consent_expires_at <= NOW())::int AS consent_expired
    FROM bi_contacts c`;
}

// BI_SERVER_MERGE_FALLBACK_v8
// first_name and full_name defaulted to the empty string, so a contact with no
// name rendered "Hi ," - and the BI list is 3,983 rows backfilled from Apollo,
// where a missing name is common. BF-Server's marketing merge has always
// defaulted to "there"; this matches it so the two silos read the same.
// company stays empty on purpose: "Hi there" reads fine, "at there" does not.
export function contactMergeVars(contact: Record<string, unknown>): Record<string, string> {
  const fullName = String(contact.full_name ?? "").trim();
  const firstName = fullName.split(/\s+/)[0] || "";
  return {
    first_name: firstName || "there",
    full_name: fullName || "there",
    email: String(contact.email ?? ""),
    company: String(contact.company ?? ""),
  };
}
