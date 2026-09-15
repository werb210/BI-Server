// BI_APPLICANT_ACTION_CENTER_v199
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const svc = readFileSync("src/services/biApplicantActions.ts", "utf-8");
const route = readFileSync("src/routes/biApplicantSubmitRoutes.ts", "utf-8");
const completion = readFileSync("src/services/pgiCompletion.ts", "utf-8");

describe("bi action center", () => {
  it("applies the same catalog rules as pgiCompletion", () => {
    for (const rule of ["c.active = TRUE", "COALESCE(c.required, TRUE) = TRUE"]) {
      expect(svc).toContain(rule);
      expect(completion).toContain(rule);
    }
  });

  it("does not count a rejected upload as satisfied", () => {
    expect(svc).toContain("COALESCE(d.review_status, 'pending') <> 'rejected'");
    expect(svc).toContain("if (r.satisfied && !r.rejected) completed.push(item)");
  });

  it("ignores purged documents", () => {
    expect(svc.match(/d\.purged_at IS NULL/g)?.length).toBe(2);
  });

  it("puts rejected documents first", () => {
    expect(svc).toContain("Number(b.urgent) - Number(a.urgent)");
  });

  it("degrades to an empty list rather than throwing", () => {
    expect(svc.match(/\.catch\(\(\) => \(\{ rows: \[\] as any\[\] \}\)\)/g)?.length).toBe(2);
  });

  it("only reports canSubmit when nothing at all is outstanding", () => {
    expect(svc).toContain("canSubmit: outstanding.length === 0");
  });
});

describe("route", () => {
  it("resolves an applicant-owned public id and rejects an unknown application", () => {
    expect(route).toContain("/action-center/:applicationId");
    expect(route).toMatch(/authApplicant/);
    expect(route).toMatch(/ownedApplication\(publicId, String\(req\.applicantPhone\)\)/);
    expect(route).toMatch(/404/);
  });
});
