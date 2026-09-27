// BI_SERVER_BLOCK_v588_APP_FIRST
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { notifyBiClient, type BiClientNotice } from "../notifyBiClient";

const notice: BiClientNotice = { applicationId: "a1", kind: "DOCUMENT_REQUEST", title: "t", body: "b", sms: "text", smsTo: "+15875550100" };

describe("notifyBiClient - app first, SMS fallback", () => {
  it("uses the app when a device takes it, and sends no text", async () => {
    const sms = vi.fn(async () => ({ sid: "S1" }));
    expect(await notifyBiClient(notice, { push: async () => 1, sms })).toEqual({ channel: "push" });
    expect(sms).not.toHaveBeenCalled();
  });
  it("texts when the app can't be reached", async () => {
    const sms = vi.fn(async () => ({ sid: "S1" }));
    expect(await notifyBiClient(notice, { push: async () => 0, sms })).toEqual({ channel: "sms", sid: "S1" });
    expect(sms).toHaveBeenCalledWith("+15875550100", "text");
  });
  it("texts when push itself fails", async () => {
    const sms = vi.fn(async () => ({ sid: "S2" }));
    expect((await notifyBiClient(notice, { push: async () => { throw new Error("apns down"); }, sms })).channel).toBe("sms");
  });
  it("reports - never throws - when there is no app and no phone, or the text fails", async () => {
    expect(await notifyBiClient({ ...notice, smsTo: null }, { push: async () => 0, sms: vi.fn() })).toEqual({ channel: "none", error: "no_phone" });
    expect((await notifyBiClient(notice, { push: async () => 0, sms: async () => { throw new Error("twilio"); } })).channel).toBe("none");
  });
  it("every applicant notice goes through it", () => {
    for (const f of ["src/routes/biDocumentRoutes.ts", "src/services/pgiOnApprovedHook.ts", "src/routes/biPublicApplicationRoutes.ts", "src/routes/biJobs.ts", "src/workers/abandonedApplicationNudge.ts"]) {
      expect(readFileSync(f, "utf8")).toContain("notifyBiClient");
    }
    expect(readFileSync("src/routes/biDocumentRoutes.ts", "utf8")).not.toContain("sendDocumentRejectedSms");
  });
});
