// BI_SERVER_BF_REFERRAL_FORM_v283
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { passesScoreGate, withDateOnlyFields } from "../services/biPublicFormGates";

describe("CORE score gate on the public form", () => {
  it("lets a BF referral save and submit before anyone has scored it", () => {
    expect(passesScoreGate({ source: "bf_pgi_referral", score_decision: null })).toBe(true);
    expect(passesScoreGate({ source: "bf_pgi_referral", score_decision: "error" })).toBe(true);
  });
  it("still blocks a declined BF referral and unscored public applications", () => {
    expect(passesScoreGate({ source: "bf_pgi_referral", score_decision: "decline" })).toBe(false);
    expect(passesScoreGate({ source: "public", score_decision: null })).toBe(false);
    expect(passesScoreGate({ source: "public", score_decision: "decline" })).toBe(false);
    expect(passesScoreGate({ source: "public", score_decision: "approve" })).toBe(true);
  });
});

describe("dates the form can show", () => {
  it("turns DATE columns into yyyy-mm-dd and leaves other fields alone", () => {
    const row = withDateOnlyFields({ guarantor_dob: new Date("1971-04-14T00:00:00.000Z"), formation_date: "2022-05-03T00:00:00.000Z", created_at: new Date("2026-09-15T19:36:08Z"), guarantor_name: "Todd" });
    expect(row.guarantor_dob).toBe("1971-04-14");
    expect(row.formation_date).toBe("2022-05-03");
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.guarantor_name).toBe("Todd");
  });
});

describe("wiring", () => {
  it("save, submit and document upload all use the shared gate", () => {
    const routes = readFileSync("src/routes/biPublicApplicationRoutes.ts", "utf-8");
    expect(routes.match(/passesScoreGate\(/g)?.length).toBe(3);
    expect(routes).not.toContain('score_decision !== "approve") return res.status(403)');
    expect(routes).toContain("withDateOnlyFields(r.rows[0])");
  });
});
