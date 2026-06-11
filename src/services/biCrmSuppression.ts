// BI_SERVER_BLOCK_v820_CRM_DELETE_SUPPRESSION
// Shared suppression writes so CRM-tab deletes and Outreach deletes can't drift.
// Pass any pg Pool/PoolClient (biCrmRoutes builds its own Pool; outreach uses ../db).
type Queryable = { query: (text: string, params?: unknown[]) => Promise<any> };

export async function suppressContacts(db: Queryable, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db.query(
    `SELECT email, phone_e164 FROM bi_contacts WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  let n = 0;
  for (const r of rows.rows as Array<{ email: string | null; phone_e164: string | null }>) {
    const ident = (r.email || r.phone_e164 || "").trim();
    if (!ident) continue;
    await db.query(
      `INSERT INTO bi_suppressions (identifier, channel, reason, email, phone_e164)
       VALUES (lower($1), 'all', 'deleted_from_crm', $2, $3)
       ON CONFLICT (identifier, channel) DO NOTHING`,
      [ident, r.email, r.phone_e164],
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
      `INSERT INTO bi_suppressions (identifier, channel, reason)
       VALUES (lower($1), 'company', 'deleted_from_crm')
       ON CONFLICT (identifier, channel) DO NOTHING`,
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
    `SELECT 1 FROM bi_suppressions WHERE channel='company' AND identifier = lower($1) LIMIT 1`,
    [name],
  );
  return r.rows.length > 0;
}
