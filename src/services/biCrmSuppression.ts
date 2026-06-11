// BI_SERVER_BLOCK_v820b_CRM_DELETE_SUPPRESSION
// Shared suppression so CRM-tab + Outreach deletes can't drift. Writes only
// columns the v820b migration guarantees (no reliance on identifier).
type Queryable = { query: (text: string, params?: unknown[]) => Promise<any> };

export async function suppressContacts(db: Queryable, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db.query(
    `SELECT email, phone_e164 FROM bi_contacts WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  let n = 0;
  for (const r of rows.rows as Array<{ email: string | null; phone_e164: string | null }>) {
    if (!r.email && !r.phone_e164) continue;
    await db.query(
      `INSERT INTO bi_suppressions (phone_e164, email, channel, reason)
       VALUES ($1, $2, 'all', 'deleted_from_crm')`,
      [r.phone_e164, r.email],
    );
    n++;
  }
  return n;
}

export async function suppressCompanies(db: Queryable, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db.query(
    `SELECT legal_name FROM bi_companies WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  let n = 0;
  for (const r of rows.rows as Array<{ legal_name: string | null }>) {
    const name = (r.legal_name || "").trim();
    if (!name) continue;
    await db.query(
      `INSERT INTO bi_suppressions (legal_name, channel, reason)
       VALUES ($1, 'company', 'deleted_from_crm')`,
      [name],
    );
    n++;
  }
  return n;
}

export async function isCompanySuppressed(db: Queryable, legalName: string): Promise<boolean> {
  const name = (legalName || "").trim();
  if (!name) return false;
  const r = await db.query(
    `SELECT 1 FROM bi_suppressions
      WHERE channel='company' AND lower(legal_name) = lower($1) LIMIT 1`,
    [name],
  );
  return r.rows.length > 0;
}
