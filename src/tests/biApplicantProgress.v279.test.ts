// BI_SERVER_APPLICANT_PROGRESS_v279
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildApplicantProgress } from "../services/biApplicantProgress";

const states = (p: ReturnType<typeof buildApplicantProgress>) => p.steps.map((s) => s.state);

describe("applicant progress", () => {
  it("an unfinished application is on the first step", () => {
    const p = buildApplicantProgress({ public_id: "BI-1", stage: "new_application", status: "in_progress" });
    expect(states(p)).toEqual(["current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
    expect(p.headline).toBe("Finish your application");
  });
  it("uses whichever column is further along", () => {
    const p = buildApplicantProgress({ stage: "new_application", status: "ready_for_submission" });
    expect(states(p).slice(0, 3)).toEqual(["done", "done", "current"]);
  });
  it("marks information required and rejected documents as needing attention", () => {
    expect(buildApplicantProgress({ status: "information_required" }).steps[3].state).toBe("attention");
    const docs = buildApplicantProgress({ stage: "docs_rejected" });
    expect(docs.steps[1].state).toBe("attention");
    expect(docs.headline).toBe("A document needs replacing");
  });
  it("shows a decline and a cancellation plainly", () => {
    const d = buildApplicantProgress({ status: "declined" });
    expect(d.steps[4].state).toBe("stopped");
    expect(d.headline).toContain("declined");
    expect(buildApplicantProgress({ status: "cancelled", stage: "under_review" }).headline).toBe("Application cancelled");
  });
  it("completes every step once the policy is issued", () => {
    expect(states(buildApplicantProgress({ stage: "bound" }))).toEqual(["done", "done", "done", "done", "done", "done"]);
  });
  it("is served to the signed-in applicant only", () => {
    const routes = readFileSync("src/routes/biApplicantDocFlowRoutes.ts", "utf-8");
    expect(routes).toContain('router.get("/applicants/me/progress", authApplicant');
    expect(routes).toContain("(applicant_phone_e164 = $1 OR guarantor_phone = $1)");
  });
});
