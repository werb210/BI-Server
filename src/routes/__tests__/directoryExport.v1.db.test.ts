// BF_SHARED_CONTACTS_STAGE2_v1 - the export BF-Server's shared contact list reads each night, against the real schema.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";

const haveDb = !!process.env.DATABASE_URL;

describe.skipIf(!haveDb)("directory export (real database)", () => {
  let pool: any;
  let SQL: string;
  const tag = `dirx-${crypto.randomUUID().slice(0, 8)}`;
  const ids: string[] = [];
  const add = async (name: string, email: string, tags: string[], country: string | null) => {
    const id = crypto.randomUUID();
    ids.push(id);
    await pool.query(`INSERT INTO bi_contacts (id, full_name, email, tags, country) VALUES ($1, $2, $3, $4, $5)`, [id, name, email, [...tags, tag], country]);
    return id;
  };

  beforeAll(async () => {
    ({ pool } = await import("../../db"));
    ({ DIRECTORY_EXPORT_SQL: SQL } = await import("../biListImportRoutes"));
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM bi_suppressions WHERE contact_id = ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM bi_contacts WHERE id = ANY($1::uuid[])`, [ids]);
  });

  it("returns brokers, lenders and banks with kind, country and opt-out; skips everyone else", async () => {
    const b = await add("Bea Broker", `bea-${tag}@x.test`, ["broker_list_nov"], "Canada");
    const l = await add("Lou Lender", `lou-${tag}@x.test`, ["lender_list"], "United States");
    const k = await add("Ben Bank", `ben-${tag}@x.test`, ["bank_us"], null);
    await add("Andy Applicant", `andy-${tag}@x.test`, ["applicant"], "Canada");
    await pool.query(`INSERT INTO bi_suppressions (contact_id, email, channel, reason) VALUES ($1, $2, 'email', 'unsubscribe')`, [l, `lou-${tag}@x.test`]);
    const r = await pool.query(SQL, [null, 100000]);
    const mine = r.rows.filter((x: any) => ids.includes(x.id));
    const by = Object.fromEntries(mine.map((x: any) => [x.id, x]));
    expect(mine).toHaveLength(3);
    expect(by[b]).toMatchObject({ kind: "broker", country: "CA", opted_out: false });
    expect(by[l]).toMatchObject({ kind: "lender", country: "US", opted_out: true });
    expect(by[k]).toMatchObject({ kind: "bank", country: "CA" });
  });

  it("pages by id", async () => {
    const first = await pool.query(SQL, [null, 1]);
    const next = await pool.query(SQL, [first.rows[0].id, 1]);
    if (next.rows.length) expect(next.rows[0].id > first.rows[0].id).toBe(true);
  });
});
