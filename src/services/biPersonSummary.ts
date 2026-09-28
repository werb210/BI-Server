// BI_SERVER_PERSON_SUMMARY_v652 - the Boreal Insurance side of one person, for the
// BF CRM AI summary and Maya: their BI contact record and PGI applications, matched
// by email or phone. Read-only.
type Db = { query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }> };

export function normalizePhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits.length >= 8 ? "+" + digits : null;
}

export function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

export async function findBiPerson(db: Db, emailRaw: unknown, phoneRaw: unknown) {
  const email = normalizeEmail(emailRaw);
  const phone = normalizePhone(phoneRaw);
  if (!email && !phone) return { ok: false as const, error: "email_or_phone_required" };
  const contacts = await db.query(
    `SELECT id::text AS id, COALESCE(NULLIF(full_name, ''), trim(concat_ws(' ', first_name, last_name))) AS name,
            email, phone_e164, lifecycle_stage, outreach_status, outreach_stage, organization_name, created_at
       FROM bi_contacts
      WHERE ($1::text IS NOT NULL AND lower(email) = $1) OR ($2::text IS NOT NULL AND phone_e164 = $2)
      ORDER BY created_at DESC LIMIT 1`,
    [email, phone],
  );
  const apps = await db.query(
    `SELECT id::text AS id, public_id, application_code, stage::text AS stage, COALESCE(company_name, business_name) AS business_name,
            coverage_amount, annual_premium, loan_amount, lender_name, carrier_last_event, carrier_last_event_at,
            policy_bound_at, signed_at, bf_application_id::text AS bf_application_id, created_at, updated_at
       FROM bi_applications
      WHERE COALESCE(is_demo, false) = false
        AND (($1::text IS NOT NULL AND lower(guarantor_email) = $1)
          OR ($2::text IS NOT NULL AND (applicant_phone_e164 = $2 OR guarantor_phone = $2)))
      ORDER BY updated_at DESC NULLS LAST LIMIT 5`,
    [email, phone],
  );
  const contact = contacts.rows[0] ?? null;
  const applications = apps.rows;
  const summary = !contact && !applications.length
    ? "No Boreal Insurance record for this person."
    : `${contact ? "BI contact found" : "No BI contact"}; ${applications.length} PGI application(s).`;
  return { ok: true as const, contact, applications, summary };
}
