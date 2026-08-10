// BI_CLIENT_SUBMIT_v25 source assertions (no DB required).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
const read = (r: string) => readFileSync(path.join(process.cwd(), r), "utf8");
const routes = read("src/routes/biApplicantSubmitRoutes.ts");
const server = read("src/server.ts");

describe("step 4 endpoints", () => {
  it("exposes a review summary and a submit", () => {
    expect(routes).toContain('router.get("/applicants/applications/:id/summary"');
    expect(routes).toContain('router.post("/applicants/applications/:id/submit"');
    expect(server).toContain('app.use("/api/v1", biCors, biApplicantSubmitRoutes);');
  });
  it("is ownership-checked and resolves me", () => {
    expect(routes).toContain('"not_owner"');
    expect(routes).toContain('if (publicIdOrId === "me")');
  });
});

describe("submission is gated server-side", () => {
  it("refuses with no coverage selected", () => {
    expect(routes).toContain('"no_coverage_selected"');
  });
  it("refuses while required questions are unanswered", () => {
    expect(routes).toContain('"questions_outstanding"');
    expect(routes).toContain("q.required = TRUE");
  });
  it("counts an unexplained adverse answer as unanswered", () => {
    expect(routes).toContain("q.adverse_answer IS NOT NULL AND a.value = q.adverse_answer");
    expect(routes).toContain("COALESCE(TRIM(a.reason),'') = ''");
  });
  it("does not trust a client-side completeness count", () => {
    expect(routes).toContain("const summary = await summaryFor(app);");
    expect(routes).not.toContain("req.body?.canSubmit");
  });
});

describe("the status it sets", () => {
  it("uses ready_for_submission, not submitted", () => {
    expect(routes).toContain("SET status = 'ready_for_submission'");
    expect(routes).not.toContain("SET status = 'submitted'");
  });
  it("only advances from created or in_progress, so a resubmit is a no-op", () => {
    expect(routes).toContain("AND status IN ('created','in_progress')");
    expect(routes).toContain("alreadySubmitted: already");
  });
});

describe("the summary shows what was actually captured", () => {
  it("returns coverages, documents and the answered count", () => {
    expect(routes).toContain("FROM bi_application_products ap JOIN bi_products p");
    expect(routes).toContain("FROM bi_documents");
    expect(routes).toContain("FROM bi_application_answers");
  });
  it("hides purged documents", () => {
    expect(routes).toContain("purged_at IS NULL");
  });
  it("carries the step 1 details back for review", () => {
    expect(routes).toContain("businessName: d.businessName");
    expect(routes).toContain("applicantName: d.applicantName");
  });
});
