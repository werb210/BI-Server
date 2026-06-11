// BI_SERVER_BLOCK_v418_COMPANIES_BY_IDS_FROM_BF
// POST /api/v1/bi/companies/by-ids/from-bf
// Service-to-service read for BF-Server's "Import lenders from BI".
// BF cannot query bi_companies directly (separate database), so it asks
// BI for the company + primary-contact shape it needs, keyed by ids.
// Auth: same service JWT ({kind:"service",source:...}) as v248/v249.
import express, { type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import { env } from "../platform/env";
import { logger } from "../platform/logger";

const router = express.Router();

function getSecret(): string {
  return (env.JWT_SECRET as string | undefined) || process.env.JWT_SECRET || "";
}
function verifyServiceJwt(req: Request): boolean {
  const auth = req.header("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const secret = getSecret();
  if (!secret) return false;
  try {
    const p = jwt.verify(m[1], secret) as { kind?: string; source?: string };
    return p?.kind === "service" && !!p?.source;
  } catch {
    return false;
  }
}

router.post("/companies/by-ids/from-bf", async (req: Request, res: Response) => {
  if (!verifyServiceJwt(req)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const raw = (req.body?.companyIds ?? req.body?.company_ids) as unknown;
  const ids = Array.isArray(raw)
    ? Array.from(new Set(raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0)))
    : [];
  if (ids.length === 0) return res.status(400).json({ ok: false, error: "companyIds is required" });

  try {
    const companies = await pool.query(
      `SELECT id, legal_name, website, phone, city, province, postal_code,
              COALESCE(tags, '{}'::text[]) AS tags
         FROM bi_companies
        WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    // One primary contact per company (earliest created) for lender contact fields.
    const contacts = await pool.query(
      `SELECT DISTINCT ON (company_id) company_id, full_name, email, phone_e164
         FROM bi_contacts
        WHERE company_id = ANY($1::uuid[])
        ORDER BY company_id, created_at ASC`,
      [ids],
    );
    const contactByCompany = new Map<string, { full_name: string | null; email: string | null; phone_e164: string | null }>();
    for (const c of contacts.rows as any[]) {
      contactByCompany.set(String(c.company_id), {
        full_name: c.full_name ?? null,
        email: c.email ?? null,
        phone_e164: c.phone_e164 ?? null,
      });
    }
    const data = (companies.rows as any[]).map((c) => ({
      id: c.id,
      legal_name: c.legal_name ?? null,
      website: c.website ?? null,
      phone: c.phone ?? null,
      city: c.city ?? null,
      province: c.province ?? null,
      postal_code: c.postal_code ?? null,
      tags: Array.isArray(c.tags) ? c.tags : [],
      primary_contact: contactByCompany.get(String(c.id)) ?? null,
    }));
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    logger.error({ err }, "bi_companies_by_ids_from_bf_failed");
    return res.status(500).json({ ok: false, error: "lookup_failed" });
  }
});

export default router;
