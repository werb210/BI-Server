// BI_SERVER_v789 items 31-34 against a real Postgres (the schema the
// migrations build). Skipped when DATABASE_URL is not set (unit config).
// Run: DATABASE_URL=postgres://postgres:postgres@localhost:5432/bi_test NODE_ENV=test \
//        npx vitest run src/routes/__tests__/biContactMerge.integration.v789.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

import { pool } from "../../db";
import { requireAuth } from "../../platform/auth";
import biInternalServiceRoutes from "../biInternalServiceRoutes";
import biCompanyActivityRoutes from "../biCompanyActivityRoutes";
import biContactMergeRoutes from "../biContactMergeRoutes";
import biNotesRoutes from "../biNotesRoutes";
import { resetDb, seedCompany } from "../../test-support/integrationDb";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/bi/internal", biInternalServiceRoutes);
  app.use("/api/v1/bi", requireAuth, Router());
  app.use("/api/v1/bi", requireAuth, biCompanyActivityRoutes);
  app.use("/api/v1/bi", requireAuth, biContactMergeRoutes);
  app.use("/api/v1/bi/applications/:id/notes", requireAuth, biNotesRoutes);
  return app;
}
const staff = () => jwt.sign({ staffUserId: "staff-v789", role: "staff", email: "s@example.com" }, process.env.JWT_SECRET as string);
const service = () => jwt.sign({ kind: "service", source: "bf-server" }, process.env.JWT_SECRET as string);

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await pool.query(sql, params);
  return r.rows[0] as T;
}
async function contact(fields: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(fields);
  const r = await pool.query<{ id: string }>(
    `INSERT INTO bi_contacts (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    cols.map((c) => fields[c]),
  );
  return r.rows[0]!.id;
}
async function application(primaryContactId: string | null): Promise<string> {
  return (await one<{ id: string }>(
    `INSERT INTO bi_applications (created_by_actor, primary_contact_id) VALUES ('staff', $1) RETURNING id`,
    [primaryContactId],
  )).id;
}

const sequenceIds: string[] = [];
const textContactIds: string[] = [];

describe.skipIf(!process.env.DATABASE_URL)("v789 contact merge / notes / company activity / internal (real DB)", () => {
  beforeEach(async () => {
    process.env.BI_SERVICE_JWT_SECRET = "";
    delete process.env.BI_SERVICE_JWT_SECRET;
    await resetDb();
  });
  afterAll(async () => {
    if (textContactIds.length) await pool.query(`DELETE FROM bi_marketing_send_events WHERE contact_id = ANY($1::text[])`, [textContactIds]);
    if (sequenceIds.length) await pool.query(`DELETE FROM bi_sequences WHERE id = ANY($1::uuid[])`, [sequenceIds]);
  });

  it("finds the duplicate, merges every reference into the keeper and deletes the duplicate", async () => {
    const co = await seedCompany({ legal_name: "Dup Co" });
    const keep = await contact({ full_name: "Keeper", phone_e164: "+14165551234", tags: ["lender"] });
    const dup = await contact({
      full_name: "Dup Person", email: "Dup@X.co", phone_e164: "416-555-1234", title: "CFO", company_id: co.id,
      tags: ["broker", "lender"], apollo_contact_id: `ap-${Date.now()}`, marketing_consent_basis: "express",
      marketing_consent_at: new Date().toISOString(),
    });
    const other = await contact({ full_name: "Unrelated", phone_e164: "+16045550000" });
    textContactIds.push(keep, dup);

    // Duplicates: phone matches on the last 10 digits; the unrelated contact does not.
    const d = await request(makeApp()).get(`/api/v1/bi/crm/contacts/${keep}/duplicates`).set("Authorization", `Bearer ${staff()}`);
    expect(d.status).toBe(200);
    expect(d.body.duplicates.map((x: { id: string }) => x.id)).toEqual([dup]);
    expect(d.body.duplicates[0].matched_on).toEqual(["phone"]);

    // Rows referencing the duplicate.
    await pool.query(`INSERT INTO bi_contact_activity (contact_id, event_type, body) VALUES ($1, 'call', 'dup call')`, [dup]);
    const appId = await application(dup);
    await pool.query(`INSERT INTO bi_activity (application_id, contact_id, actor_type, event_type, summary) VALUES ($1, $2, 'system', 'x', 'y')`, [appId, dup]);
    await pool.query(
      `INSERT INTO bi_documents (application_id, doc_type, uploaded_by_actor, original_filename, mime_type, bytes) VALUES ($1, 'other', 'staff', 'a.pdf', 'application/pdf', 10)`,
      [appId],
    );
    await pool.query(
      `INSERT INTO bi_documents (application_id, doc_type, uploaded_by_actor, original_filename, purged_at) VALUES ($1, 'other', 'staff', 'gone.pdf', now())`,
      [appId],
    );
    const s1 = (await one<{ id: string }>(`INSERT INTO bi_sequences (name) VALUES ('v789 s1') RETURNING id`)).id;
    const s2 = (await one<{ id: string }>(`INSERT INTO bi_sequences (name) VALUES ('v789 s2') RETURNING id`)).id;
    sequenceIds.push(s1, s2);
    await pool.query(`INSERT INTO bi_sequence_enrollments (sequence_id, contact_id) VALUES ($1, $2), ($1, $3), ($4, $3)`, [s1, keep, dup, s2]);
    await pool.query(`INSERT INTO bi_apollo_enrichment (contact_id, title) VALUES ($1, 'CFO')`, [dup]);
    await pool.query(`INSERT INTO bi_suppressions (contact_id, email, channel, reason) VALUES ($1, 'dup@x.co', 'email', 'manual')`, [dup]);
    await pool.query(`INSERT INTO bi_marketing_send_events (contact_id, email, event_type) VALUES ($1::text, 'dup@x.co', 'delivered')`, [dup]);

    const m = await request(makeApp()).post(`/api/v1/bi/crm/contacts/${keep}/merge`).set("Authorization", `Bearer ${staff()}`).send({ duplicate_id: dup });
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ ok: true, id: keep, merged_id: dup });

    expect((await pool.query(`SELECT 1 FROM bi_contacts WHERE id = $1`, [dup])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM bi_contacts WHERE id = $1`, [other])).rowCount).toBe(1);
    const k = await one<Record<string, any>>(`SELECT * FROM bi_contacts WHERE id = $1`, [keep]);
    expect(k.full_name).toBe("Keeper");
    expect(k.phone_e164).toBe("+14165551234");
    expect(k.email).toBe("Dup@X.co");
    expect(k.title).toBe("CFO");
    expect(k.company_id).toBe(co.id);
    expect([...k.tags].sort()).toEqual(["broker", "lender"]);
    expect(k.apollo_contact_id).toMatch(/^ap-/);
    expect(k.marketing_consent_basis).toBe("express");
    expect(k.marketing_consent_at).not.toBeNull();

    const acts = await pool.query(`SELECT body FROM bi_contact_activity WHERE contact_id = $1 ORDER BY created_at`, [keep]);
    expect(acts.rows.map((r) => r.body)).toContain("dup call");
    expect(acts.rows.some((r) => String(r.body).startsWith("Merged duplicate contact"))).toBe(true);
    expect((await one<{ primary_contact_id: string }>(`SELECT primary_contact_id FROM bi_applications WHERE id = $1`, [appId])).primary_contact_id).toBe(keep);
    expect((await pool.query(`SELECT 1 FROM bi_activity WHERE contact_id = $1`, [keep])).rowCount).toBe(1);
    const enr = await pool.query(`SELECT sequence_id FROM bi_sequence_enrollments WHERE contact_id = $1 ORDER BY sequence_id`, [keep]);
    expect(enr.rows.map((r) => r.sequence_id).sort()).toEqual([s1, s2].sort());
    expect((await pool.query(`SELECT 1 FROM bi_sequence_enrollments WHERE contact_id = $1`, [dup])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM bi_apollo_enrichment WHERE contact_id = $1`, [keep])).rowCount).toBe(1);
    expect((await pool.query(`SELECT 1 FROM bi_suppressions WHERE contact_id = $1`, [keep])).rowCount).toBe(1);
    expect((await pool.query(`SELECT 1 FROM bi_marketing_send_events WHERE contact_id = $1::text`, [keep])).rowCount).toBe(1);

    // Documents of the linked application, unpurged only.
    const docs = await request(makeApp()).get(`/api/v1/bi/crm/contacts/${keep}/documents`).set("Authorization", `Bearer ${staff()}`);
    expect(docs.status).toBe(200);
    expect(docs.body.documents.map((x: { original_filename: string }) => x.original_filename)).toEqual(["a.pdf"]);
    expect(docs.body.documents[0]).toMatchObject({ application_id: appId, doc_type: "other", mime_type: "application/pdf", review_status: "pending" });

    // Merging again: the duplicate is gone.
    const again = await request(makeApp()).post(`/api/v1/bi/crm/contacts/${keep}/merge`).set("Authorization", `Bearer ${staff()}`).send({ duplicate_id: dup });
    expect(again.status).toBe(404);
  });

  it("documents also come from applications linked through bi_activity", async () => {
    const c = await contact({ full_name: "Via Activity" });
    const appId = await application(null);
    await pool.query(`INSERT INTO bi_activity (application_id, contact_id, actor_type, event_type, summary) VALUES ($1, $2, 'system', 'x', 'y')`, [appId, c]);
    await pool.query(`INSERT INTO bi_documents (application_id, doc_type, uploaded_by_actor, original_filename) VALUES ($1, 'other', 'staff', 'b.pdf')`, [appId]);
    const r = await request(makeApp()).get(`/api/v1/bi/crm/contacts/${c}/documents`).set("Authorization", `Bearer ${staff()}`);
    expect(r.body.documents.map((x: { original_filename: string }) => x.original_filename)).toEqual(["b.pdf"]);
  });

  it("application notes: POST then GET newest first, 404 for an unknown application", async () => {
    const appId = await application(null);
    await pool.query(`INSERT INTO bi_staff_profile (staff_user_id, full_name) VALUES ('staff-v789', 'Sam Staff') ON CONFLICT (staff_user_id) DO UPDATE SET full_name = EXCLUDED.full_name`);
    const a = await request(makeApp()).post(`/api/v1/bi/applications/${appId}/notes`).set("Authorization", `Bearer ${staff()}`).send({ body: " first " });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ body: "first", author_name: "Sam Staff" });
    const b = await request(makeApp()).post(`/api/v1/bi/applications/${appId}/notes`).set("Authorization", `Bearer ${staff()}`).send({ body: "second" });
    expect(b.status).toBe(201);
    const list = await request(makeApp()).get(`/api/v1/bi/applications/${appId}/notes`).set("Authorization", `Bearer ${staff()}`);
    expect(list.status).toBe(200);
    expect(list.body.notes.map((n: { body: string }) => n.body)).toEqual(["second", "first"]);
    expect(Object.keys(list.body.notes[0]).sort()).toEqual(["author_name", "body", "created_at", "id"]);
    const missing = "99999999-9999-4999-8999-999999999999";
    expect((await request(makeApp()).post(`/api/v1/bi/applications/${missing}/notes`).set("Authorization", `Bearer ${staff()}`).send({ body: "x" })).status).toBe(404);
    expect((await request(makeApp()).get(`/api/v1/bi/applications/${missing}/notes`).set("Authorization", `Bearer ${staff()}`)).status).toBe(404);
    await pool.query(`DELETE FROM bi_staff_profile WHERE staff_user_id = 'staff-v789'`);
  });

  it("company activity: POST then GET newest first", async () => {
    const co = await seedCompany({ legal_name: "Activity Co" });
    for (const body of ["one", "two"]) {
      const r = await request(makeApp()).post(`/api/v1/bi/crm/companies/${co.id}/activity`).set("Authorization", `Bearer ${staff()}`)
        .send({ event_type: "note", body, meta: { k: body } });
      expect(r.status).toBe(201);
    }
    const g = await request(makeApp()).get(`/api/v1/bi/crm/companies/${co.id}/activity`).set("Authorization", `Bearer ${staff()}`);
    expect(g.status).toBe(200);
    expect(g.body.events.map((e: { body: string }) => e.body)).toEqual(["two", "one"]);
    expect(g.body.events[0].meta).toEqual({ k: "two" });
    const missing = "99999999-9999-4999-8999-999999999999";
    expect((await request(makeApp()).post(`/api/v1/bi/crm/companies/${missing}/activity`).set("Authorization", `Bearer ${staff()}`).send({ event_type: "note" })).status).toBe(404);
  });

  it("internal outreach advance is forward-only and matches by phone digits / email", async () => {
    const a = await contact({ full_name: "A", phone_e164: "+14165550001", outreach_status: "cold" });
    const b = await contact({ full_name: "B", email: "b@x.co", outreach_status: "demo_booked" });
    const c = await contact({ full_name: "C", email: "c@x.co" });
    const adv = (body: unknown) => request(makeApp()).post("/api/v1/bi/internal/outreach/advance").set("Authorization", `Bearer ${service()}`).send(body as object);

    let r = await adv({ match: { phone: "(416) 555-0001" }, to: "contacted" });
    expect(r.body).toEqual({ ok: true, updated: 1 });
    r = await adv({ match: { email: "B@X.CO" }, to: "contacted" });
    expect(r.body).toEqual({ ok: true, updated: 0 });
    r = await adv({ match: { email: "c@x.co", id: a }, to: "engaged" });
    expect(r.body).toEqual({ ok: true, updated: 2 });
    const rows = await pool.query(`SELECT id, outreach_status, outreach_updated_at FROM bi_contacts WHERE id = ANY($1::uuid[])`, [[a, b, c]]);
    const by = Object.fromEntries(rows.rows.map((x) => [x.id, x]));
    expect(by[a].outreach_status).toBe("engaged");
    expect(by[b].outreach_status).toBe("demo_booked");
    expect(by[c].outreach_status).toBe("engaged");
    expect(by[c].outreach_updated_at).not.toBeNull();

    const g = await request(makeApp()).get(`/api/v1/bi/internal/outreach/contacts/${b}`).set("Authorization", `Bearer ${service()}`);
    expect(g.body).toEqual({ full_name: "B", email: "b@x.co", phone_e164: null, company_id: null });
  });
});
