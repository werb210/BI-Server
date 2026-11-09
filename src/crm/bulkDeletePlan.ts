// BI_SERVER_v914_PARTIAL_BULK_DELETE - same behaviour as the Financial CRM (BF-Server v907): a mass delete removes the
// records that can go and reports the rest with the reason, instead of failing the whole selection. Before this, one
// contact that had received a campaign email (bi_marketing_send_recipients has no ON DELETE) made the whole batch
// fail with a database error, and deleting an applicant silently cut the link from their application.
type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
export type SkippedDelete = { id: string; name: string; reason: string };

export async function planContactDelete(db: Q, ids: string[]): Promise<{ deletable: string[]; skipped: SkippedDelete[] }> {
  if (!ids.length) return { deletable: [], skipped: [] };
  const r = await db.query(
    `SELECT c.id::text AS id, COALESCE(NULLIF(btrim(c.full_name), ''), c.email, c.id::text) AS name
       FROM bi_contacts c
      WHERE c.id = ANY($1::uuid[])
        AND EXISTS (SELECT 1 FROM bi_applications a WHERE a.primary_contact_id = c.id)`, [ids]);
  const skipped: SkippedDelete[] = r.rows.map((x: any) => ({ id: String(x.id), name: String(x.name), reason: "linked to an application" }));
  const blocked = new Set(skipped.map((s) => s.id));
  return { deletable: ids.filter((id) => !blocked.has(id)), skipped };
}

export async function planCompanyDelete(db: Q, ids: string[]): Promise<{ deletable: string[]; skipped: SkippedDelete[] }> {
  if (!ids.length) return { deletable: [], skipped: [] };
  const r = await db.query(
    `SELECT co.id::text AS id, COALESCE(NULLIF(btrim(co.legal_name), ''), NULLIF(btrim(co.operating_name), ''), co.id::text) AS name
       FROM bi_companies co
      WHERE co.id = ANY($1::uuid[])
        AND EXISTS (SELECT 1 FROM bi_applications a WHERE a.company_id = co.id)`, [ids]);
  const skipped: SkippedDelete[] = r.rows.map((x: any) => ({ id: String(x.id), name: String(x.name), reason: "linked to an application" }));
  const blocked = new Set(skipped.map((s) => s.id));
  return { deletable: ids.filter((id) => !blocked.has(id)), skipped };
}

/** Removes campaign-recipient rows that would block the delete (the suppression list keeps the email opted out). */
export async function clearContactSendHistory(db: Q, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.query(`DELETE FROM bi_marketing_send_recipients WHERE contact_id = ANY($1::uuid[])`, [ids]);
}
