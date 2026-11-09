// BI_SERVER_CUSTOM_FIELDS_v1 - /api/v1/bi/custom-fields: custom fields on Insurance contacts and companies. Same contract
// as BF-Server /api/custom-fields (v870), so the portal's Properties and record panels work unchanged in the BI silo.
//   GET  /                         field types, limits and every object's fields (staff)
//   GET  /:object                  the object's fields, ?include_archived=1 (staff)
//   POST /:object                  create (Admin)        PATCH /:object/:fieldId  change (Admin)
//   POST /:object/:fieldId/archive | /unarchive (Admin)  PUT /:object/order { ids } (Admin)
//   GET  /:object/records/:recordId   the record's fields and values (staff)
//   PUT  /:object/records/:recordId   { values: { name: value | null } } (staff)
import { Router, type Request, type Response } from "express";
import { pool } from "../db";
import { logger } from "../platform/logger";
import { requireStaffUser } from "../middleware/requireStaffUser";
import { FIELD_TYPES, FIELD_TYPE_LABEL, LIMITS, OBJECT_TYPES, isObjectType, type ObjectType } from "../services/customFields/definitions";
import {
  createDefinition, getDefinition, listDefinitions, readRecordValues, reorder, setArchived, updateDefinition, writeRecordValues, type Q,
} from "../services/customFields/service";

const router = Router();
router.use("/custom-fields", requireStaffUser);
const db = () => pool as unknown as Q;
const isAdmin = (req: Request) => ["admin", "owner"].includes(String((req as any).user?.role ?? "").toLowerCase());
const actor = (req: Request): string | null => { const u = (req as any).user ?? {}; return u.id ? String(u.id) : u.userId ? String(u.userId) : null; };

function objectOr404(req: Request, res: Response): ObjectType | null {
  const o = String(req.params.object ?? "");
  if (!isObjectType(o)) { res.status(404).json({ ok: false, error: "unknown_object", message: "Use contact or company." }); return null; }
  return o;
}
function adminOr403(req: Request, res: Response): boolean {
  if (isAdmin(req)) return true;
  res.status(403).json({ ok: false, error: "admin_only", message: "Only an Admin can change custom fields." });
  return false;
}
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try { await fn(req, res); } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), path: req.path }, "bi_custom_fields_failed");
    if (!res.headersSent) res.status(500).json({ ok: false, error: "custom_fields_failed" });
  }
};

router.get("/custom-fields", wrap(async (_req, res) => {
  const objects: Record<string, unknown> = {};
  for (const o of OBJECT_TYPES) objects[o] = await listDefinitions(db(), o, { includeArchived: true });
  res.json({
    ok: true, silo: "BI",
    field_types: FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_LABEL[t] })),
    limits: { active_per_object: LIMITS.activePerObject, total_per_object: LIMITS.totalPerObject, options_per_field: LIMITS.optionsPerField },
    objects,
  });
}));

router.get("/custom-fields/:object", wrap(async (req, res) => {
  const object = objectOr404(req, res); if (!object) return;
  const includeArchived = ["1", "true"].includes(String(req.query.include_archived ?? ""));
  res.json({ ok: true, fields: await listDefinitions(db(), object, { includeArchived }) });
}));

router.post("/custom-fields/:object", wrap(async (req, res) => {
  const object = objectOr404(req, res); if (!object || !adminOr403(req, res)) return;
  const r = await createDefinition(db(), object, req.body ?? {}, actor(req));
  if (!r.ok) return res.status(r.status).json({ ok: false, error: "invalid_field", message: r.errors.join(" "), errors: r.errors });
  res.status(201).json({ ok: true, field: r.definition });
}));

router.put("/custom-fields/:object/order", wrap(async (req, res) => {
  const object = objectOr404(req, res); if (!object || !adminOr403(req, res)) return;
  await reorder(db(), object, Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []);
  res.json({ ok: true, fields: await listDefinitions(db(), object, { includeArchived: true }) });
}));

router.patch("/custom-fields/:object/:fieldId", wrap(async (req, res) => {
  const object = objectOr404(req, res); if (!object || !adminOr403(req, res)) return;
  const def = await getDefinition(db(), String(req.params.fieldId ?? ""));
  if (!def || def.object_type !== object) return res.status(404).json({ ok: false, error: "not_found" });
  const r = await updateDefinition(db(), def, req.body ?? {}, actor(req));
  if (!r.ok) return res.status(r.status).json({ ok: false, error: "invalid_field", message: r.errors.join(" "), errors: r.errors });
  res.json({ ok: true, field: r.definition });
}));

for (const [path, archived] of [["archive", true], ["unarchive", false]] as const) {
  router.post(`/custom-fields/:object/:fieldId/${path}`, wrap(async (req, res) => {
    const object = objectOr404(req, res); if (!object || !adminOr403(req, res)) return;
    const def = await getDefinition(db(), String(req.params.fieldId ?? ""));
    if (!def || def.object_type !== object) return res.status(404).json({ ok: false, error: "not_found" });
    const r = await setArchived(db(), def, archived, actor(req));
    if (!r.ok) return res.status(r.status).json({ ok: false, error: "invalid_field", message: r.errors.join(" "), errors: r.errors });
    res.json({ ok: true, field: r.definition });
  }));
}

router.get("/custom-fields/:object/records/:recordId", wrap(async (req, res) => {
  const object = objectOr404(req, res); if (!object) return;
  const values = await readRecordValues(db(), object, String(req.params.recordId ?? ""));
  if (!values) return res.status(404).json({ ok: false, error: "not_found" });
  const defs = await listDefinitions(db(), object, { includeArchived: true });
  const fields = defs.filter((d) => !d.archived_at || Object.prototype.hasOwnProperty.call(values, d.name));
  res.json({ ok: true, fields, values });
}));

router.put("/custom-fields/:object/records/:recordId", wrap(async (req, res) => {
  const object = objectOr404(req, res); if (!object) return;
  const w = await writeRecordValues(db(), object, String(req.params.recordId ?? ""), req.body?.values ?? {}, { requireAll: req.body?.validate_required !== false });
  if (!w.ok) return res.status(w.status).json({ ok: false, error: w.status === 404 ? "not_found" : "invalid_values", message: w.errors.map((e) => e.error).join(" "), errors: w.errors });
  res.json({ ok: true, values: w.custom_fields });
}));

export default router;
