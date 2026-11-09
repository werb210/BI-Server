// BI_SERVER_COMPANY_FROM_EMAIL_v1 - parity with BF-Server v925. A contact with a work email but no company is linked to
// the company whose domain/website matches the email domain, else to a new company named from the domain
// (kathrina@signnow.com -> "Signnow"). Free mail (gmail, outlook, shaw.ca, ...) is never used. Every 10 minutes.
import { pool } from "../../db";
import { logger } from "../../platform/logger";
import { FREE_EMAIL_DOMAINS } from "./webSource";

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

const SKIP = [...new Set([...FREE_EMAIL_DOMAINS].map((d) => d.toLowerCase()))];
const STOP = new Set(["example.com", "example.org", "test.com", "localhost"]);

export function emailDomain(email: unknown): string | null {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})\s*$/i.exec(String(email ?? "").trim());
  if (!m) return null;
  const d = m[1]!.toLowerCase().replace(/^(mail|email|www)\./, "");
  return SKIP.includes(d) || STOP.has(d) ? null : d;
}

export function companyNameFromDomain(domain: string): string {
  const parts = domain.toLowerCase().split(".");
  let core = parts.length > 2 && /^(co|com|org|net|gov|gc|ac)$/.test(parts[parts.length - 2]!) ? parts[parts.length - 3]! : parts[parts.length - 2] ?? parts[0]!;
  core = core.replace(/[_-]+/g, " ").trim();
  return core.split(" ").filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

const HOST_SQL = (col: string) => `lower(regexp_replace(regexp_replace(coalesce(${col}, ''), '^https?://(www\\.)?', ''), '[/:?#].*$', ''))`;

export async function linkCompaniesFromEmail(db: Q = pool as unknown as Q, limit = 500): Promise<{ linked: number; created: number }> {
  const r = await db.query(
    `SELECT c.id::text AS id, c.email FROM bi_contacts c
      WHERE c.company_id IS NULL AND c.converted_to_company_id IS NULL AND c.email LIKE '%_@_%.__%'
        AND lower(split_part(c.email, '@', 2)) <> ALL($1::text[])
      ORDER BY c.created_at DESC LIMIT $2`,
    [SKIP, limit],
  );
  let linked = 0; let created = 0;
  for (const c of r.rows as Array<{ id: string; email: string }>) {
    const domain = emailDomain(c.email);
    if (!domain) continue;
    const found = await db.query(
      `SELECT id::text AS id FROM bi_companies
        WHERE lower(coalesce(domain, '')) = $1 OR ${HOST_SQL("website")} = $1
        ORDER BY created_at ASC LIMIT 1`,
      [domain],
    );
    let companyId: string | undefined = found.rows[0]?.id;
    if (!companyId) {
      const ins = await db.query(
        `INSERT INTO bi_companies (legal_name, domain, website) VALUES ($1, $2, $3) RETURNING id::text AS id`,
        [companyNameFromDomain(domain), domain, `https://${domain}`],
      );
      companyId = ins.rows[0]?.id;
      if (companyId) created += 1;
    }
    if (!companyId) continue;
    const up = await db.query(`UPDATE bi_contacts SET company_id = $2::uuid, updated_at = now() WHERE id = $1::uuid AND company_id IS NULL`, [c.id, companyId]);
    linked += up.rowCount ?? 0;
  }
  return { linked, created };
}

let running = false;
export function startCompanyFromEmailJob(): void {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const out = await linkCompaniesFromEmail();
      if (out.linked || out.created) logger.info(out, "[company-from-email] linked");
    } catch (e) {
      logger.error({ err: e instanceof Error ? e.message : String(e) }, "[company-from-email] tick failed");
    } finally { running = false; }
  };
  const handle = setInterval(() => { void tick(); }, 10 * 60 * 1000);
  if (typeof (handle as any).unref === "function") (handle as any).unref();
  setTimeout(() => { void tick(); }, 60_000).unref();
}
