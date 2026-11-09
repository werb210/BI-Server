// BI_SERVER_CUSTOM_FIELDS_v1 - custom field definitions and record values for the Insurance CRM (same behaviour as
// BF-Server v870 src/customFields/service.ts; one silo, so no silo column).
import {
  LIMITS, mergeValues, validateDefinition, validateValues, type CleanDefinition, type DefinitionInput, type FieldDefinition,
  type ObjectType,
} from "./definitions";

export type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export const RECORD_TABLE: Record<ObjectType, string> = { contact: "bi_contacts", company: "bi_companies" };
const UUID = /^[0-9a-f-]{36}$/i;
const COLS = `id::text AS id, object_type, name, label, field_type, options, required, group_name, description, sort_order,
              archived_at, created_at, updated_at`;

function rowToDef(r: any): FieldDefinition {
  return {
    id: String(r.id), silo: "BI", object_type: r.object_type, name: String(r.name), label: String(r.label), field_type: r.field_type,
    options: Array.isArray(r.options) ? r.options : [], required: Boolean(r.required), group_name: r.group_name ?? null,
    description: r.description ?? null, sort_order: Number(r.sort_order ?? 0), archived_at: r.archived_at ?? null,
    ...(r.created_at ? { created_at: r.created_at, updated_at: r.updated_at } : {}),
  } as FieldDefinition;
}

export async function listDefinitions(db: Q, object: ObjectType, opts: { includeArchived?: boolean } = {}): Promise<FieldDefinition[]> {
  const r = await db.query(
    `SELECT ${COLS} FROM bi_custom_field_definitions WHERE object_type = $1 ORDER BY COALESCE(group_name, ''), sort_order, created_at`,
    [object],
  );
  const defs = (r?.rows ?? []).map(rowToDef);
  return opts.includeArchived ? defs : defs.filter((d) => !d.archived_at);
}

export async function getDefinition(db: Q, id: string): Promise<FieldDefinition | null> {
  if (!UUID.test(id)) return null;
  const r = await db.query(`SELECT ${COLS} FROM bi_custom_field_definitions WHERE id = $1`, [id]);
  return r.rows[0] ? rowToDef(r.rows[0]) : null;
}

export type DefinitionWrite = { ok: true; definition: FieldDefinition } | { ok: false; status: number; errors: string[] };

export async function createDefinition(db: Q, object: ObjectType, input: DefinitionInput, actor: string | null): Promise<DefinitionWrite> {
  const v = validateDefinition(input);
  if (!v.ok) return { ok: false, status: 400, errors: v.errors };
  const counts = await db.query(
    `SELECT count(*) FILTER (WHERE archived_at IS NULL)::int AS active, count(*)::int AS total FROM bi_custom_field_definitions WHERE object_type = $1`,
    [object],
  );
  if (Number(counts.rows[0]?.active ?? 0) >= LIMITS.activePerObject) return { ok: false, status: 409, errors: [`You can have at most ${LIMITS.activePerObject} fields in use on ${object === "company" ? "companies" : "contacts"}. Archive one first.`] };
  if (Number(counts.rows[0]?.total ?? 0) >= LIMITS.totalPerObject) return { ok: false, status: 409, errors: [`This record type already has ${LIMITS.totalPerObject} fields, including archived ones.`] };
  const c: CleanDefinition = v.value;
  const order = input.sort_order === undefined
    ? Number((await db.query(`SELECT COALESCE(max(sort_order), 0) + 10 AS n FROM bi_custom_field_definitions WHERE object_type = $1`, [object])).rows[0]?.n ?? 0)
    : c.sort_order;
  try {
    const r = await db.query(
      `INSERT INTO bi_custom_field_definitions (object_type, name, label, field_type, options, required, group_name, description, sort_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $10) RETURNING ${COLS}`,
      [object, c.name, c.label, c.field_type, JSON.stringify(c.options), c.required, c.group_name, c.description, order, actor],
    );
    return { ok: true, definition: rowToDef(r.rows[0]) };
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return { ok: false, status: 409, errors: [`A field with the internal name "${c.name}" already exists (it may be archived).`] };
    throw err;
  }
}

export async function updateDefinition(db: Q, existing: FieldDefinition, input: DefinitionInput, actor: string | null): Promise<DefinitionWrite> {
  const v = validateDefinition(input, existing);
  if (!v.ok) return { ok: false, status: 400, errors: v.errors };
  const c = v.value;
  const r = await db.query(
    `UPDATE bi_custom_field_definitions
        SET label = $2, field_type = $3, options = $4::jsonb, required = $5, group_name = $6, description = $7, sort_order = $8,
            updated_by = $9, updated_at = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [existing.id, c.label, c.field_type, JSON.stringify(c.options), c.required, c.group_name, c.description, c.sort_order, actor],
  );
  if (existing.field_type === "single_select" && c.field_type === "multi_select") {
    await db.query(
      `UPDATE ${RECORD_TABLE[existing.object_type as ObjectType]} SET custom_fields = jsonb_set(custom_fields, ARRAY[$1::text], jsonb_build_array(custom_fields->$1))
        WHERE jsonb_typeof(custom_fields->$1) = 'string'`,
      [existing.name],
    );
  }
  return { ok: true, definition: rowToDef(r.rows[0]) };
}

export async function setArchived(db: Q, existing: FieldDefinition, archived: boolean, actor: string | null): Promise<DefinitionWrite> {
  if (!archived) {
    const active = await db.query(`SELECT count(*)::int AS n FROM bi_custom_field_definitions WHERE object_type = $1 AND archived_at IS NULL`, [existing.object_type]);
    if (Number(active.rows[0]?.n ?? 0) >= LIMITS.activePerObject) return { ok: false, status: 409, errors: [`You already have ${LIMITS.activePerObject} fields in use. Archive one first.`] };
  }
  const r = await db.query(
    `UPDATE bi_custom_field_definitions SET archived_at = ${archived ? "COALESCE(archived_at, now())" : "NULL"}, updated_by = $2, updated_at = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [existing.id, actor],
  );
  return { ok: true, definition: rowToDef(r.rows[0]) };
}

export async function reorder(db: Q, object: ObjectType, ids: string[]): Promise<void> {
  const clean = ids.filter((id) => UUID.test(id)).slice(0, LIMITS.totalPerObject);
  if (!clean.length) return;
  await db.query(
    `UPDATE bi_custom_field_definitions d SET sort_order = x.ord * 10, updated_at = now()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS x(id, ord) WHERE d.id = x.id AND d.object_type = $1`,
    [object, clean],
  );
}

export type ValuesWrite =
  | { ok: true; custom_fields: Record<string, unknown>; changed: string[] }
  | { ok: false; status: number; errors: Array<{ field: string; error: string }> };

export async function readRecordValues(db: Q, object: ObjectType, recordId: string): Promise<Record<string, unknown> | null> {
  if (!UUID.test(recordId)) return null;
  const r = await db.query(`SELECT custom_fields FROM ${RECORD_TABLE[object]} WHERE id = $1::uuid`, [recordId]);
  return r.rows[0] ? ((r.rows[0].custom_fields ?? {}) as Record<string, unknown>) : null;
}

export async function writeRecordValues(db: Q, object: ObjectType, recordId: string, input: unknown, opts: { requireAll?: boolean } = {}): Promise<ValuesWrite> {
  const current = await readRecordValues(db, object, recordId);
  if (!current) return { ok: false, status: 404, errors: [{ field: "", error: "Record not found." }] };
  const defs = await listDefinitions(db, object, { includeArchived: true });
  const check = validateValues(defs, input, current, opts);
  if (check.errors.length) return { ok: false, status: 400, errors: check.errors };
  const changed = Object.keys(check.changes);
  if (!changed.length) return { ok: true, custom_fields: current, changed };
  const set = Object.fromEntries(Object.entries(check.changes).filter(([, v]) => v !== null));
  const removed = Object.entries(check.changes).filter(([, v]) => v === null).map(([k]) => k);
  const r = await db.query(
    `UPDATE ${RECORD_TABLE[object]} SET custom_fields = (COALESCE(custom_fields, '{}'::jsonb) - $2::text[]) || $3::jsonb, updated_at = now()
      WHERE id = $1::uuid RETURNING custom_fields`,
    [recordId, removed, JSON.stringify(set)],
  );
  return { ok: true, custom_fields: (r.rows[0]?.custom_fields ?? mergeValues(current, check.changes)) as Record<string, unknown>, changed };
}
