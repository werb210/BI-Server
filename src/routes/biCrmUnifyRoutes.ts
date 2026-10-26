// BI_SERVER_v856_CRM_UNIFY - /api/v1/bi/crm/unified/* : the shared CRM features, the same contract BF-Server serves
// at /api/crm/unified/* for BF, SLF and KS, so the portal's one set of CRM components works in BI unchanged.
// Mounted in server.ts behind requireAuth; staff only (service tokens 403). BI data stays in BI-Server.
//   GET  /crm/unified/tags                       POST /crm/unified/tags/definitions (Admin)   DELETE .../:slug (Admin)
//   POST /crm/unified/tags/apply {entity, ids, add, remove}   system tags refused
//   GET  /crm/unified/companies/:id/people       POST .../people {contactId | contact, role}  POST .../people/remove
//   GET  /crm/unified/companies/:id/details      PATCH .../details
//   GET  /crm/unified/duplicates/:entity/:id     GET /crm/unified/duplicates?entity=   POST /crm/unified/duplicates/dismiss
//   GET  /crm/unified/merge/:entity/preview?ids= POST /crm/unified/merge/:entity {survivorId, loserIds, fields}
//   GET  /crm/unified/cleanup/scan?entity=       POST /crm/unified/cleanup/apply   GET .../batches   POST .../batches/:id/undo
//   GET  /crm/unified/ai-summary/:entity/:id     POST /crm/unified/ai-summary/:entity/:id (rate limited)
//   POST /crm/unified/duplicates/merge-placeholders {dryRun}   GET /crm/unified/contacts/:id/applications|related|survivor
//   POST /crm/unified/people/backfill (Admin)
// Adding/removing company people, merges and clean-up are written to bi_crm_audit (and the company timeline).
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db";
import { logger } from "../platform/logger";
import { logHiddenError } from "../platform/safeError";
import { rateLimitKeyFromRequest } from "../middleware/rateLimitKey";
import { requireStaffUser } from "../middleware/requireStaffUser";
import { crmActorFrom } from "../lib/crmActivityInput";
import { CORE_TAGS, isSystemTag, normalizeTags, tagCatalogue, tagFromLabel } from "../services/crmUnify/tags";
import { companyPeople, isPersonRole, personKey, ROLE_LABELS } from "../services/crmUnify/people";
import { companyDetails, detailUpdates } from "../services/crmUnify/companyDetails";
import {
  CONTACT_MERGE_FIELDS, companyDuplicates, contactDuplicates, dismissDuplicate, duplicateGroups, mergePreview, pickFieldChoices,
} from "../services/crmUnify/duplicates";
import { mergeCompanies } from "../services/crmUnify/companyMerge";
import { applyCleanup, listBatches, scanCleanup, undoCleanup, validChange } from "../services/crmUnify/cleanup";
import { cachedSummary, generateSummary } from "../services/crmUnify/aiSummary";

const router = Router();
router.use("/crm/unified", requireStaffUser);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const entityOf = (v: unknown): "contact" | "company" | null => (v === "contact" || v === "company" ? v : null);
const isAdmin = (req: Request) => {
  const role = String((req as any).user?.role ?? "").toLowerCase();
  return role === "admin" || role === "owner";
};

async function audit(req: Request, action: string, entity: string, entityId: string, meta: Record<string, unknown>) {
  const actor = crmActorFrom(req);
  try {
    await pool.query(
      `INSERT INTO bi_crm_audit (action, entity, entity_id, actor_id, actor_name, meta) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [action, entity, entityId, actor.id, actor.name, JSON.stringify(meta)],
    );
  } catch (err) {
    logger.warn({ err, action, entityId }, "bi_crm_unified_audit_failed");
  }
}

async function companyNote(req: Request, companyId: string, body: string, meta: Record<string, unknown>) {
  const actor = crmActorFrom(req);
  try {
    await pool.query(
      `INSERT INTO bi_company_activity (company_id, actor_id, actor_name, event_type, body, meta) VALUES ($1, $2, $3, 'note', $4, $5::jsonb)`,
      [companyId, actor.id, actor.name, body.slice(0, 8000), JSON.stringify(meta)],
    );
  } catch (err) {
    logger.warn({ err, companyId }, "bi_crm_unified_company_note_failed");
  }
}

const fail = (req: Request, res: Response, err: unknown, code: string) =>
  res.status(Number((err as any)?.status) || 500).json({ ok: false, error: (err as any)?.status ? (err as Error).message : code, requestId: logHiddenError(req, err, code) });

const summaryLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" },
  keyGenerator: rateLimitKeyFromRequest,
});

/* ---------- tags ---------- */

router.get("/crm/unified/tags", async (req, res) => {
  try { return res.json({ ok: true, data: await tagCatalogue(pool) }); } catch (err) { return fail(req, res, err, "tags_failed"); }
});

router.post("/crm/unified/tags/definitions", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "admin_only" });
  const def = tagFromLabel(req.body?.label);
  if (!def) return res.status(400).json({ ok: false, error: "label_required" });
  if (CORE_TAGS.some((t) => t.slug === def.slug)) return res.status(409).json({ ok: false, error: "already_a_shared_tag" });
  if (isSystemTag(def.slug)) return res.status(409).json({ ok: false, error: "reserved_system_tag" });
  try {
    await pool.query(
      `INSERT INTO bi_crm_tag_definitions (slug, label, created_by) VALUES ($1, $2, $3) ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label`,
      [def.slug, def.label, crmActorFrom(req).id],
    );
    await audit(req, "crm.tag_definition_added", "crm_tag", def.slug, { label: def.label });
    return res.status(201).json({ ok: true, data: def });
  } catch (err) { return fail(req, res, err, "tag_definition_failed"); }
});

router.delete("/crm/unified/tags/definitions/:slug", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "admin_only" });
  try {
    const r = await pool.query(`DELETE FROM bi_crm_tag_definitions WHERE slug = $1`, [String(req.params.slug)]);
    if (!r.rowCount) return res.status(404).json({ ok: false, error: "not_found" });
    await audit(req, "crm.tag_definition_removed", "crm_tag", String(req.params.slug), {});
    return res.json({ ok: true });
  } catch (err) { return fail(req, res, err, "tag_definition_failed"); }
});

router.post("/crm/unified/tags/apply", async (req, res) => {
  const entity = entityOf(req.body?.entity);
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter(isUuid) : [];
  const add = normalizeTags(req.body?.add ?? []);
  const remove = normalizeTags(req.body?.remove ?? []);
  if (!entity || !ids.length || (!add.length && !remove.length)) return res.status(400).json({ ok: false, error: "entity_ids_and_tags_required" });
  const sys = [...add, ...remove].filter(isSystemTag);
  if (sys.length) return res.status(400).json({ ok: false, error: "system_tag", message: `${sys.join(", ")} is set automatically and cannot be added or removed by hand.` });
  try {
    const table = entity === "contact" ? "bi_contacts" : "bi_companies";
    const r = await pool.query(
      `UPDATE ${table}
          SET tags = bi_norm_tags(ARRAY(SELECT t FROM unnest(coalesce(tags, '{}'::text[]) || $2::text[]) t
                                         WHERE NOT (bi_norm_tag(t) = ANY($3::text[])))),
              updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [ids, add, remove],
    );
    return res.json({ ok: true, updated: r.rowCount ?? 0, added: add, removed: remove });
  } catch (err) { return fail(req, res, err, "tags_apply_failed"); }
});

/* ---------- company people ---------- */

router.get("/crm/unified/companies/:id/people", async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  try {
    const exists = await pool.query(`SELECT 1 FROM bi_companies WHERE id = $1::uuid`, [id]);
    if (!exists.rowCount) return res.status(404).json({ ok: false, error: "not_found" });
    // The company's applications' directors / partners / guarantors become contacts the first time staff look.
    const { syncBiApplicationPeople } = await import("../services/crmUnify/peopleSync");
    const apps = await pool.query(
      `SELECT id::text AS id FROM bi_applications
        WHERE company_id = $1::uuid OR primary_contact_id IN (SELECT id FROM bi_contacts WHERE company_id = $1::uuid)
        ORDER BY updated_at DESC NULLS LAST LIMIT 10`,
      [id],
    );
    for (const a of apps.rows as Array<{ id: string }>) {
      await syncBiApplicationPeople(pool, a.id).catch((syncErr: unknown) => logger.warn({ err: syncErr, applicationId: a.id }, "bi_crm_people_sync_failed"));
    }
    return res.json({ ok: true, data: { ...(await companyPeople(pool, id)), roles: ROLE_LABELS } });
  } catch (err) { return fail(req, res, err, "company_people_failed"); }
});

router.post("/crm/unified/companies/:id/people", async (req, res) => {
  const companyId = String(req.params.id);
  const role = req.body?.role ?? "other";
  if (!isUuid(companyId)) return res.status(400).json({ ok: false, error: "invalid_id" });
  if (!isPersonRole(role)) return res.status(400).json({ ok: false, error: "invalid_role" });
  try {
    const company = (await pool.query(`SELECT id, legal_name FROM bi_companies WHERE id = $1::uuid`, [companyId])).rows[0];
    if (!company) return res.status(404).json({ ok: false, error: "not_found" });
    let contactId: string | null = isUuid(req.body?.contactId) ? req.body.contactId : null;
    let created = false;
    if (contactId) {
      const c = await pool.query(`SELECT id FROM bi_contacts WHERE id = $1::uuid`, [contactId]);
      if (!c.rowCount) return res.status(404).json({ ok: false, error: "contact_not_found" });
    } else {
      const nc = req.body?.contact ?? {};
      const name = String(nc.name ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      const email = String(nc.email ?? "").replace(/\s+/g, "").toLowerCase().slice(0, 200) || null;
      const phone = String(nc.phone ?? "").trim().slice(0, 40) || null;
      if (!name && !email) return res.status(400).json({ ok: false, error: "name_or_email_required" });
      if (email) {
        const existing = (await pool.query(`SELECT id::text AS id FROM bi_contacts WHERE lower(trim(email)) = $1 LIMIT 1`, [email])).rows[0];
        if (existing) contactId = existing.id;
      }
      if (!contactId) {
        const ins = await pool.query(
          `INSERT INTO bi_contacts (company_id, full_name, email, phone_e164, outreach_status, outreach_updated_at)
           VALUES ($1::uuid, $2, $3, $4, 'new', now()) RETURNING id::text AS id`,
          [companyId, name || email, email, phone],
        );
        contactId = ins.rows[0].id as string;
        created = true;
      }
    }
    await pool.query(
      `INSERT INTO bi_crm_company_people (company_id, contact_id, role, created_by) VALUES ($1::uuid, $2::uuid, $3, $4)
       ON CONFLICT (company_id, contact_id) DO UPDATE SET role = EXCLUDED.role`,
      [companyId, contactId, role, crmActorFrom(req).id],
    );
    await pool.query(`UPDATE bi_contacts SET company_id = $2::uuid, updated_at = now() WHERE id = $1::uuid AND company_id IS NULL`, [contactId, companyId]);
    await pool.query(`DELETE FROM bi_crm_company_people_hidden WHERE company_id = $1::uuid AND person_key = $2`, [companyId, `contact:${contactId}`]);
    await audit(req, "crm.company_person_added", "company", companyId, { contactId, role, created });
    await companyNote(req, companyId, `Added a person to the company as ${ROLE_LABELS[role]}`, { kind: "company_person_added", contact_id: contactId, role });
    return res.status(201).json({ ok: true, data: { contactId, role, created } });
  } catch (err) { return fail(req, res, err, "company_person_add_failed"); }
});

router.post("/crm/unified/companies/:id/people/remove", async (req, res) => {
  const companyId = String(req.params.id);
  if (!isUuid(companyId)) return res.status(400).json({ ok: false, error: "invalid_id" });
  try {
    const exists = await pool.query(`SELECT 1 FROM bi_companies WHERE id = $1::uuid`, [companyId]);
    if (!exists.rowCount) return res.status(404).json({ ok: false, error: "not_found" });
    const contactId = isUuid(req.body?.contactId) ? req.body.contactId : null;
    const email = typeof req.body?.email === "string" && req.body.email.includes("@") ? req.body.email.trim().toLowerCase() : null;
    const key = typeof req.body?.key === "string" && req.body.key.trim() ? req.body.key.trim().slice(0, 300) : personKey({ contactId, email, name: req.body?.name });
    const keys = Array.from(new Set([key, contactId ? `contact:${contactId}` : null, email ? `email:${email}` : null].filter(Boolean) as string[]));
    for (const k of keys) {
      await pool.query(
        `INSERT INTO bi_crm_company_people_hidden (company_id, person_key, created_by) VALUES ($1::uuid, $2, $3) ON CONFLICT (company_id, person_key) DO NOTHING`,
        [companyId, k, crmActorFrom(req).id],
      );
    }
    if (contactId) {
      await pool.query(`DELETE FROM bi_crm_company_people WHERE company_id = $1::uuid AND contact_id = $2::uuid`, [companyId, contactId]);
      await pool.query(`UPDATE bi_contacts SET company_id = NULL, updated_at = now() WHERE id = $1::uuid AND company_id = $2::uuid`, [contactId, companyId]);
    }
    await audit(req, "crm.company_person_removed", "company", companyId, { contactId, keys });
    await companyNote(req, companyId, "Removed a person from the company", { kind: "company_person_removed", contact_id: contactId, keys });
    return res.json({ ok: true });
  } catch (err) { return fail(req, res, err, "company_person_remove_failed"); }
});

/* ---------- company details ---------- */

router.get("/crm/unified/companies/:id/details", async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  try {
    const out = await companyDetails(pool, id);
    if (!out) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, data: { fields: out.fields, tags: Array.isArray(out.company.tags) ? out.company.tags : [] } });
  } catch (err) { return fail(req, res, err, "company_details_failed"); }
});

router.patch("/crm/unified/companies/:id/details", async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  const parsed = detailUpdates(req.body ?? {});
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error, field: parsed.field });
  if (!parsed.sets.length) return res.json({ ok: true, updated: 0 });
  try {
    const r = await pool.query(
      `UPDATE bi_companies SET ${parsed.sets.map(([c], i) => `"${c}" = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1::uuid`,
      [id, ...parsed.sets.map(([, v]) => v)],
    );
    if (!r.rowCount) return res.status(404).json({ ok: false, error: "not_found" });
    const out = await companyDetails(pool, id);
    return res.json({ ok: true, data: { fields: out?.fields ?? [] } });
  } catch (err) { return fail(req, res, err, "company_details_save_failed"); }
});

/* ---------- duplicates and merge ---------- */

router.get("/crm/unified/duplicates/:entity/:id", async (req, res) => {
  const entity = entityOf(req.params.entity);
  const id = String(req.params.id);
  if (!entity || !isUuid(id)) return res.status(400).json({ ok: false, error: "invalid_request" });
  try {
    const candidates = entity === "contact" ? await contactDuplicates(pool, id) : await companyDuplicates(pool, id);
    return res.json({ ok: true, data: { count: candidates.length, candidates } });
  } catch (err) { return fail(req, res, err, "duplicates_failed"); }
});

router.get("/crm/unified/duplicates", async (req, res) => {
  const entity = entityOf(req.query.entity) ?? "contact";
  try { return res.json({ ok: true, data: { entity, groups: await duplicateGroups(pool, entity) } }); } catch (err) { return fail(req, res, err, "duplicates_failed"); }
});

router.post("/crm/unified/duplicates/dismiss", async (req, res) => {
  const entity = entityOf(req.body?.entity);
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter(isUuid) : [];
  if (!entity || ids.length < 2) return res.status(400).json({ ok: false, error: "entity_and_two_ids_required" });
  try {
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) await dismissDuplicate(pool, entity, ids[i]!, ids[j]!, crmActorFrom(req).id);
    return res.json({ ok: true });
  } catch (err) { return fail(req, res, err, "dismiss_failed"); }
});

router.get("/crm/unified/merge/:entity/preview", async (req, res) => {
  const entity = entityOf(req.params.entity);
  const ids = String(req.query.ids ?? "").split(",").map((x) => x.trim()).filter(isUuid);
  if (!entity || ids.length < 2) return res.status(400).json({ ok: false, error: "two_ids_required" });
  try { return res.json({ ok: true, data: await mergePreview(pool, entity, Array.from(new Set(ids)).slice(0, 5)) }); } catch (err) { return fail(req, res, err, "merge_preview_failed"); }
});

// Each duplicate goes through the existing BI contact merge (moves every reference, unions tags, deletes it), then the
// values staff picked side by side are written to the survivor. Runs inside the caller's transaction.
async function mergeContactGroup(client: any, req: Request, survivorId: string, loserIds: string[], fields: unknown): Promise<Record<string, unknown>> {
  const { mergeBiContactRows } = await import("./biContactMergeRoutes");
  const rows = (await client.query(`SELECT * FROM bi_contacts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [[survivorId, ...loserIds]])).rows;
  const survivor = rows.find((r: any) => String(r.id) === survivorId);
  if (!survivor || rows.length !== loserIds.length + 1) throw Object.assign(new Error("contact not found"), { status: 404 });
  if (survivor.converted_to_company_id) throw Object.assign(new Error("This contact was converted to a company. Merge into a live contact instead."), { status: 409 });
  const moved: Record<string, Record<string, number>> = {};
  for (const loserId of loserIds) {
    const dup = rows.find((r: any) => String(r.id) === loserId);
    moved[loserId] = (await mergeBiContactRows(client, survivorId, loserId, dup, req)).moved;
  }
  const choices = pickFieldChoices(CONTACT_MERGE_FIELDS, rows, fields);
  if (choices.length) {
    await client.query(
      `UPDATE bi_contacts SET ${choices.map(([k], i) => `"${k}" = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1::uuid`,
      [survivorId, ...choices.map(([, v]) => v)],
    );
  }
  return { survivorId, loserIds, moved };
}

router.post("/crm/unified/merge/:entity", async (req, res) => {
  const entity = entityOf(req.params.entity);
  const survivorId = req.body?.survivorId;
  const loserIds: string[] = Array.isArray(req.body?.loserIds) ? Array.from(new Set(req.body.loserIds.filter(isUuid))) : [];
  if (!entity || !isUuid(survivorId) || !loserIds.length) return res.status(400).json({ ok: false, error: "survivorId_and_loserIds_required" });
  if (loserIds.includes(survivorId)) return res.status(400).json({ ok: false, error: "cannot_merge_into_itself" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let data: Record<string, unknown>;
    if (entity === "contact") {
      data = await mergeContactGroup(client, req, survivorId, loserIds, req.body?.fields);
    } else {
      data = await mergeCompanies(client, { survivorId, loserIds, fields: req.body?.fields, userId: crmActorFrom(req).id });
    }
    await client.query("COMMIT");
    await audit(req, entity === "contact" ? "crm.contacts_merged" : "crm.companies_merged", entity, survivorId, { loserIds });
    if (entity === "company") await companyNote(req, survivorId, `Merged ${loserIds.length} duplicate compan${loserIds.length === 1 ? "y" : "ies"} into this one`, { kind: "merge", loserIds });
    return res.json({ ok: true, data });
  } catch (err) {
    await client.query("ROLLBACK").catch((rbErr: unknown) => logger.warn({ err: rbErr }, "bi_crm_unified_merge_rollback_failed"));
    return fail(req, res, err, "merge_failed");
  } finally {
    client.release();
  }
});

// Placeholder contacts ("Unknown (application started)") that share a phone or email with a real record are merged into
// the suggested survivor (the real record), one group per transaction. dryRun lists what would happen.
router.post("/crm/unified/duplicates/merge-placeholders", async (req, res) => {
  try {
    const groups = (await duplicateGroups(pool, "contact", 1000))
      .filter((g) => g.placeholders > 0 && !g.records.find((r: any) => r.id === g.survivorId && r.placeholder));
    const plan = groups.map((g) => ({
      survivorId: g.survivorId,
      survivorName: (g.records.find((r: any) => r.id === g.survivorId) as any)?.name ?? null,
      loserIds: g.records.filter((r: any) => r.placeholder && r.id !== g.survivorId).map((r: any) => String(r.id)),
    })).filter((x) => x.loserIds.length > 0);
    if (req.body?.dryRun === true) return res.json({ ok: true, data: { groups: plan.length, contacts: plan.reduce((n, x) => n + x.loserIds.length, 0), plan } });
    let merged = 0;
    const failed: Array<{ survivorId: string; error: string }> = [];
    for (const item of plan) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await mergeContactGroup(client, req, item.survivorId, item.loserIds, null);
        await client.query("COMMIT");
        merged += item.loserIds.length;
      } catch (err) {
        await client.query("ROLLBACK").catch((rbErr: unknown) => logger.warn({ err: rbErr }, "bi_crm_placeholder_merge_rollback_failed"));
        logger.warn({ err, survivorId: item.survivorId }, "bi_crm_placeholder_merge_failed");
        failed.push({ survivorId: item.survivorId, error: (err as Error)?.message ?? "merge_failed" });
      } finally {
        client.release();
      }
    }
    await audit(req, "crm.placeholders_merged", "contact", plan[0]?.survivorId ?? "-", { groups: plan.length, merged, failed: failed.length });
    return res.json({ ok: true, data: { groups: plan.length, merged, failed } });
  } catch (err) { return fail(req, res, err, "merge_placeholders_failed"); }
});

/* ---------- contact panel and people backfill ---------- */

router.get("/crm/unified/contacts/:id/applications", async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  try {
    const { biContactApplications } = await import("../services/crmUnify/contactPanel");
    return res.json({ ok: true, data: await biContactApplications(pool, id) });
  } catch (err) { return fail(req, res, err, "contact_applications_failed"); }
});

// BI has no advisor links (the Professional Advisors form is BF's); same contract, always empty.
router.get("/crm/unified/contacts/:id/related", async (req, res) => {
  if (!isUuid(String(req.params.id))) return res.status(400).json({ ok: false, error: "invalid_id" });
  return res.json({ ok: true, data: [] });
});

// BI merges delete the duplicate, so there is no merge chain to follow; same contract as BF.
router.get("/crm/unified/contacts/:id/survivor", async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  try {
    const r = await pool.query(`SELECT full_name, converted_to_company_id FROM bi_contacts WHERE id = $1::uuid`, [id]);
    const row = r.rows[0];
    return res.json({ ok: true, data: { id, requestedId: id, merged: false, archived: Boolean(row?.converted_to_company_id), missing: !row, name: row?.full_name ?? null } });
  } catch (err) { return fail(req, res, err, "contact_survivor_failed"); }
});

router.post("/crm/unified/people/backfill", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "admin_only" });
  try {
    const { backfillBiCrmPeople } = await import("../services/crmUnify/peopleSync");
    const out = await backfillBiCrmPeople(pool);
    await audit(req, "crm.people_backfill", "application", "-", out);
    return res.json({ ok: true, data: out });
  } catch (err) { return fail(req, res, err, "people_backfill_failed"); }
});

/* ---------- data clean-up ---------- */

router.get("/crm/unified/cleanup/scan", async (req, res) => {
  const entity = entityOf(req.query.entity) ?? "contact";
  try { return res.json({ ok: true, data: { entity, changes: await scanCleanup(pool, entity) } }); } catch (err) { return fail(req, res, err, "cleanup_scan_failed"); }
});

router.post("/crm/unified/cleanup/apply", async (req, res) => {
  const list: unknown[] = Array.isArray(req.body?.changes) ? req.body.changes : [];
  const changes = list.filter(validChange);
  if (!changes.length) return res.status(400).json({ ok: false, error: "no_valid_changes" });
  if (changes.length > 5000) return res.status(400).json({ ok: false, error: "too_many_changes" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await applyCleanup(client, changes, crmActorFrom(req).id);
    await client.query("COMMIT");
    await audit(req, "crm.cleanup_applied", "crm_cleanup_batch", out.batchId, { applied: out.applied, skipped: out.skipped.length });
    return res.json({ ok: true, data: out });
  } catch (err) {
    await client.query("ROLLBACK").catch((rbErr: unknown) => logger.warn({ err: rbErr }, "bi_crm_unified_cleanup_rollback_failed"));
    return fail(req, res, err, "cleanup_apply_failed");
  } finally {
    client.release();
  }
});

router.get("/crm/unified/cleanup/batches", async (req, res) => {
  try { return res.json({ ok: true, data: await listBatches(pool) }); } catch (err) { return fail(req, res, err, "cleanup_batches_failed"); }
});

router.post("/crm/unified/cleanup/batches/:id/undo", async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(400).json({ ok: false, error: "invalid_id" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await undoCleanup(client, id, crmActorFrom(req).id);
    if (!out.ok) { await client.query("ROLLBACK"); return res.status(out.status).json({ ok: false, error: out.error }); }
    await client.query("COMMIT");
    await audit(req, "crm.cleanup_undone", "crm_cleanup_batch", id, { restored: out.restored, skipped: out.skipped.length });
    return res.json({ ok: true, data: out });
  } catch (err) {
    await client.query("ROLLBACK").catch((rbErr: unknown) => logger.warn({ err: rbErr }, "bi_crm_unified_undo_rollback_failed"));
    return fail(req, res, err, "cleanup_undo_failed");
  } finally {
    client.release();
  }
});

/* ---------- AI summary ---------- */

router.get("/crm/unified/ai-summary/:entity/:id", async (req, res) => {
  const entity = entityOf(req.params.entity);
  const id = String(req.params.id);
  if (!entity || !isUuid(id)) return res.status(400).json({ ok: false, error: "invalid_request" });
  try { return res.json({ ok: true, data: await cachedSummary(pool, entity, id) }); } catch (err) { return fail(req, res, err, "ai_summary_failed"); }
});

router.post("/crm/unified/ai-summary/:entity/:id", summaryLimiter, async (req, res) => {
  const entity = entityOf(req.params.entity);
  const id = String(req.params.id);
  if (!entity || !isUuid(id)) return res.status(400).json({ ok: false, error: "invalid_request" });
  try {
    const analytics = await import("./biContactAnalyticsRoutes");
    const model = analytics.biSummaryModel;
    const out = await generateSummary(pool, { model, contactSummary: (cid) => analytics.summaryForContact(cid, model) }, entity, id, crmActorFrom(req).id);
    if ("error" in out) return res.status(out.status).json({ ok: false, error: out.error });
    return res.json({ ok: true, data: out });
  } catch (err) { return fail(req, res, err, "ai_summary_failed"); }
});

export default router;
