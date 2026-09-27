// BI_SERVER_BLOCK_v585 - rewritten. Creating and enrolling sequences moved from biSequencesRoutes
// to biMarketingRoutes (mounted at /api/v1/bi/marketing), so the old test hit a router that no
// longer has these routes. This version runs the real routes against the real test database
// (schema baseline + reference lists) and pins today's rules, including the CASL consent gate,
// which it only observes - it does not change it.
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { pool } from "../../db";
import router from "../biMarketingRoutes";

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => { req.user = { id: "00000000-0000-0000-0000-000000000001" }; next(); });
  a.use(router);
  return a;
}

let templateId = "";
beforeAll(async () => {
  const t = await pool.query<{ id: string }>(
    `INSERT INTO bi_email_templates (name, subject, body_html) VALUES ('v585 test', 'Hi {{first_name}}', '<p>Hello</p>') RETURNING id`,
  );
  templateId = t.rows[0].id;
});

async function contact(email: string, consent: string | null): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO bi_contacts (full_name, first_name, email, marketing_consent_basis, marketing_consent_at)
     VALUES ('Seq Test', 'Seq', $1, $2, CASE WHEN $2::text IS NULL THEN NULL ELSE NOW() END) RETURNING id`,
    [email, consent],
  );
  return r.rows[0].id;
}

describe("BI sequences (real database)", () => {
  it("creates a sequence with an email, a wait and an SMS step, and lists it", async () => {
    const r = await request(app()).post("/sequences").send({
      name: "v585 sequence",
      steps: [{ type: "email", template_id: templateId }, { type: "wait", delay_seconds: 86400 }, { type: "sms", body: "hello" }],
    });
    expect(r.status).toBe(201);
    const list = await request(app()).get("/sequences");
    const found = list.body.sequences.find((s: any) => s.id === r.body.sequence.id);
    expect(found).toMatchObject({ name: "v585 sequence", step_count: 3, source: "portal" });
  });

  it("refuses an email step with no template, subject or body", async () => {
    const r = await request(app()).post("/sequences").send({ name: "empty", steps: [{ type: "email" }] });
    expect(r.status).toBe(400);
  });

  it("enrolls a contact with a consent basis and skips one without, saying why", async () => {
    const seq = await request(app()).post("/sequences").send({ name: "v585 enroll", steps: [{ type: "email", template_id: templateId }] });
    const withConsent = await contact(`with-${Date.now()}@example.com`, "express");
    const noConsent = await contact(`without-${Date.now()}@example.com`, null);
    const r = await request(app()).post(`/sequences/${seq.body.sequence.id}/enroll`).send({ contactIds: [withConsent, noConsent] });
    expect(r.status).toBe(200);
    expect(r.body.inserted).toBe(1);
    expect(r.body.skips).toEqual([{ contact_id: noConsent, reason: "no_consent_basis" }]);
    const e = await pool.query(`SELECT contact_id, status FROM bi_sequence_enrollments WHERE sequence_id = $1`, [seq.body.sequence.id]);
    expect(e.rows).toEqual([{ contact_id: withConsent, status: "active" }]);
  });
});
