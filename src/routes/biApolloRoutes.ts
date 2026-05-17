// BI_SERVER_BLOCK_v253_APOLLO_PHASE1_SCAFFOLD_v1
// BI Apollo routes. All paths nest under /api/v1/bi/apollo/*.
// Auth: requireAuth (staff JWT). Mock-mode results are returned
// with mock=true so the portal can clearly badge them.
import express, { type Request, type Response } from "express";
import { pool } from "../db";
import { requireAuth } from "../platform/auth";
import { logger } from "../platform/logger";
import {
  apolloIsLive,
  enrichPerson,
  listSequences,
  enrollContact,
  listMailboxes,
} from "../services/apolloClient";

const router = express.Router();
router.use(requireAuth);

function s(v: unknown, max = 1000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

function actorId(req: Request): string | null {
  const u = (req as any).user as Record<string, unknown> | undefined;
  return typeof u?.staffUserId === "string" ? u.staffUserId : null;
}

// BI_SERVER_BLOCK_48_v1 -- stubs for endpoints the BF-portal
// biApollo client expects. Apollo data plumbing isn't wired yet.
// Returning shape-correct empty responses keeps the UI from
// red-toasting on every visit. Real implementations land when
// the Apollo backend integration ships.
router.get("/apollo/replies", async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const per_page = Number(req.query.per_page ?? 50);
  res.json({
    replies: [],
    pagination: { page, per_page, total_entries: 0, total_pages: 0 },
  });
});

router.get("/apollo/email-accounts", async (_req: Request, res: Response) => {
  res.json({ email_accounts: [] });
});

// GET /apollo/health — quick is-it-live + mailbox snapshot.
router.get("/apollo/health", async (_req: Request, res: Response) => {
  const live = apolloIsLive();
  try {
    const mb = await listMailboxes();
    return res.json({
      ok: true,
      live,
      mock: mb.mock,
      mailboxes: mb.mailboxes,
    });
  } catch (e: any) {
    logger.error({ err: e }, "apollo_health_failed");
    return res.status(502).json({ ok: false, error: "apollo_unreachable", live });
  }
});

// BI_SERVER_BLOCK_48_v1 -- the /contacts/:id/marketing and
// /contacts/:id/enrich endpoints that the BF Contact card BI
// panel calls. Pre-fix these returned 404 because the BF contact
// UUID isn't in bi_contacts. The BF Contact card is hitting BI
// for ENRICHMENT, not for a known BI contact; absence is normal,
// not an error. Surface empty data with 200 so the panel renders
// "No marketing data yet" instead of an error.
router.get("/contacts/:contact_id/marketing", async (_req: Request, res: Response) => {
  res.json({
    contact: null,
    sequences: [],
    last_synced_at: null,
    replies: [],
  });
});

router.post("/contacts/:contact_id/enrich", async (_req: Request, res: Response) => {
  res.json({ enqueued: false, reason: "apollo_enrichment_not_configured" });
});

// POST /apollo/enrich/:contact_id
// Enriches a bi_contact using Apollo person-match. Caches the
// result into bi_apollo_enrichment (one row per contact).
router.post("/apollo/enrich/:contact_id", async (req: Request, res: Response) => {
  const contactId = s(req.params.contact_id);
  if (!contactId) return res.status(400).json({ ok: false, error: "id_required" });
  try {
    const c = await pool.query<{
      full_name: string;
      email: string | null;
      company_id: string | null;
    }>(
      `SELECT full_name, email, company_id FROM bi_contacts WHERE id = $1 LIMIT 1`,
      [contactId],
    );
    if (!c.rows[0]) {
      return res.json({
        ok: true,
        mock: true,
        person: null,
        contact: null,
        sequences: [],
        last_synced_at: null,
        replies: [],
      });
    }
    let companyName: string | null = null;
    let companyDomain: string | null = null;
    if (c.rows[0].company_id) {
      const co = await pool.query<{ legal_name: string; primary_domain: string | null }>(
        // primary_domain may not exist on bi_companies in all envs;
        // COALESCE to NULL via to_jsonb pattern keeps this safe.
        `SELECT legal_name,
                NULLIF(NULLIF((to_jsonb(bi_companies)::jsonb)->>'primary_domain', ''), 'null') AS primary_domain
           FROM bi_companies WHERE id = $1 LIMIT 1`,
        [c.rows[0].company_id],
      );
      companyName = co.rows[0]?.legal_name ?? null;
      companyDomain = co.rows[0]?.primary_domain ?? null;
    }
    const result = await enrichPerson({
      full_name: c.rows[0].full_name,
      email: c.rows[0].email,
      company_name: companyName,
      company_domain: companyDomain,
    });

    const p = result.person;
    if (p) {
      await pool.query(
        `INSERT INTO bi_apollo_enrichment
           (contact_id, apollo_person_id, email, title, linkedin_url,
            company_name, company_domain, seniority, raw_json, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
         ON CONFLICT (contact_id) DO UPDATE
           SET apollo_person_id = EXCLUDED.apollo_person_id,
               email            = COALESCE(EXCLUDED.email, bi_apollo_enrichment.email),
               title            = COALESCE(EXCLUDED.title, bi_apollo_enrichment.title),
               linkedin_url     = COALESCE(EXCLUDED.linkedin_url, bi_apollo_enrichment.linkedin_url),
               company_name     = COALESCE(EXCLUDED.company_name, bi_apollo_enrichment.company_name),
               company_domain   = COALESCE(EXCLUDED.company_domain, bi_apollo_enrichment.company_domain),
               seniority        = COALESCE(EXCLUDED.seniority, bi_apollo_enrichment.seniority),
               raw_json         = EXCLUDED.raw_json,
               fetched_at       = NOW()`,
        [
          contactId,
          p.id ?? null,
          p.email ?? null,
          p.title ?? null,
          p.linkedin_url ?? null,
          p.organization?.name ?? null,
          p.organization?.primary_domain ?? null,
          p.seniority ?? null,
          JSON.stringify(result.raw),
        ],
      );
    }

    return res.json({
      ok: true,
      mock: result.mock,
      person: p,
    });
  } catch (e: any) {
    logger.error({ err: e, contactId }, "apollo_enrich_failed");
    return res.status(502).json({ ok: false, error: e?.message ?? "enrich_failed" });
  }
});

// GET /apollo/sequences — list known sequences and (optionally)
// sync from Apollo if ?sync=true.
router.get("/apollo/sequences", async (req: Request, res: Response) => {
  const sync = String(req.query.sync ?? "") === "true";
  try {
    if (sync) {
      const live = await listSequences();
      for (const seq of live.sequences) {
        await pool.query(
          `INSERT INTO bi_apollo_sequence (apollo_sequence_id, name, is_active, raw_json, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, NOW())
           ON CONFLICT (apollo_sequence_id) DO UPDATE
             SET name = EXCLUDED.name,
                 is_active = EXCLUDED.is_active,
                 updated_at = NOW()`,
          [seq.id, seq.name, seq.active ?? true, JSON.stringify(seq)],
        );
      }
    }
    const r = await pool.query(
      `SELECT id, apollo_sequence_id, name, is_active, created_at, updated_at
         FROM bi_apollo_sequence
        ORDER BY is_active DESC, name ASC`,
    );
    return res.json({ ok: true, sequences: r.rows, live: apolloIsLive() });
  } catch (e: any) {
    logger.error({ err: e }, "apollo_sequences_failed");
    return res.status(502).json({ ok: false, error: "sequences_failed" });
  }
});

// POST /apollo/sequences/:id/enroll/:contact_id
// Adds a bi_contact to an Apollo sequence and writes a row to
// bi_apollo_enrollment.
router.post("/apollo/sequences/:id/enroll/:contact_id", async (req: Request, res: Response) => {
  const sequenceId = s(req.params.id);
  const contactId = s(req.params.contact_id);
  if (!sequenceId || !contactId) {
    return res.status(400).json({ ok: false, error: "ids_required" });
  }
  try {
    const seq = await pool.query<{ apollo_sequence_id: string | null; name: string }>(
      `SELECT apollo_sequence_id, name FROM bi_apollo_sequence WHERE id = $1 LIMIT 1`,
      [sequenceId],
    );
    if (!seq.rows[0]) return res.status(404).json({ ok: false, error: "sequence_not_found" });
    const apolloSeqId = seq.rows[0].apollo_sequence_id;
    if (!apolloSeqId) {
      return res.status(400).json({ ok: false, error: "sequence_missing_apollo_id" });
    }
    const c = await pool.query<{ full_name: string; email: string | null }>(
      `SELECT full_name, email FROM bi_contacts WHERE id = $1 LIMIT 1`,
      [contactId],
    );
    if (!c.rows[0]) {
      return res.json({
        ok: true,
        mock: true,
        person: null,
        contact: null,
        sequences: [],
        last_synced_at: null,
        replies: [],
      });
    }
    if (!c.rows[0].email) {
      return res.status(400).json({ ok: false, error: "contact_has_no_email" });
    }
    const [first, ...rest] = (c.rows[0].full_name ?? "").split(/\s+/);
    const enroll = await enrollContact({
      apollo_sequence_id: apolloSeqId,
      email: c.rows[0].email,
      first_name: first ?? null,
      last_name: rest.length ? rest.join(" ") : null,
    });

    await pool.query(
      `INSERT INTO bi_apollo_enrollment
         (contact_id, sequence_id, apollo_contact_id, status, enrolled_by, enrolled_at, raw_json)
       VALUES ($1, $2, $3, 'active', $4, NOW(), $5::jsonb)
       ON CONFLICT (contact_id, sequence_id) DO UPDATE
         SET apollo_contact_id = EXCLUDED.apollo_contact_id,
             status            = 'active',
             enrolled_at       = NOW(),
             raw_json          = EXCLUDED.raw_json`,
      [contactId, sequenceId, enroll.apollo_contact_id, actorId(req), JSON.stringify(enroll.raw)],
    );

    return res.json({
      ok: true,
      mock: enroll.mock,
      apollo_contact_id: enroll.apollo_contact_id,
    });
  } catch (e: any) {
    logger.error({ err: e, sequenceId, contactId }, "apollo_enroll_failed");
    return res.status(502).json({ ok: false, error: e?.message ?? "enroll_failed" });
  }
});

export default router;
