// BI_CLIENT_SELECTION_v23 source assertions (no DB required).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
const read = (r: string) => readFileSync(path.join(process.cwd(), r), "utf8");
const routes = read("src/routes/biApplicantSelectionRoutes.ts");
const server = read("src/server.ts");

describe("step 2 selection endpoints", () => {
  it("reads and writes the applicant's picks", () => {
    expect(routes).toContain('router.get("/applicants/applications/:id/products"');
    expect(routes).toContain('router.post("/applicants/applications/:id/products"');
    expect(server).toContain('app.use("/api/v1", biCors, biApplicantSelectionRoutes);');
  });
  it("is ownership-checked, not just authenticated", () => {
    expect(routes).toContain('"not_owner"');
    expect(routes).toContain("applicant_phone_e164, guarantor_phone");
  });
});

describe("contract-derived lines are protected", () => {
  it("only client_added rows are ever deleted here", () => {
    expect(routes).toContain("ap.source = 'client_added'");
    expect(routes).not.toContain("ap.source = 'contract'");
  });
  it("writes picks as client_added", () => {
    expect(routes).toContain("'client_added' FROM bi_products p");
  });
});

describe("replace-set semantics", () => {
  it("deletes what is no longer ticked and inserts what is", () => {
    expect(routes).toContain("NOT (p.code = ANY($2::text[]))");
    expect(routes).toContain("ON CONFLICT (application_id, product_id) DO NOTHING");
  });
  it("runs as one transaction so a half-applied selection cannot persist", () => {
    expect(routes).toContain('client.query("BEGIN")');
    expect(routes).toContain('client.query("ROLLBACK")');
    expect(routes).toContain("client.release()");
  });
  it("dedupes and caps the incoming codes", () => {
    expect(routes).toContain("Array.from(new Set(");
    expect(routes).toContain(".slice(0, 40)");
  });
  it("only ever matches products in the application's own country", () => {
    expect(routes).toContain("WHERE p.country = $3 AND p.active = TRUE");
  });
});

describe("picking coverage advances the application", () => {
  it("moves created to in_progress, and only from created", () => {
    expect(routes).toContain("SET status = 'in_progress'");
    expect(routes).toContain("AND status = 'created'");
  });
});

describe("the no-contract path can find its own application", () => {
  it('resolves the literal "me" to the caller in-flight application', () => {
    expect(routes).toContain('if (publicIdOrId === "me")');
    expect(routes).toContain("status IN ('created','in_progress')");
  });
  it("returns the country so the client does not have to guess it", () => {
    expect((routes.match(/country: normCountry\(app\.country\)/g) || []).length).toBe(2);
    expect((routes.match(/applicationId: app\.public_id/g) || []).length).toBe(2);
  });
});
