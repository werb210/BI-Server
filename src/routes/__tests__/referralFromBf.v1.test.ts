// BI_SERVER_REFERRAL_FROM_BF_v1
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), "utf8");

describe("bi-server referral unified into BF", () => {
  it("signs a bi-server service JWT and posts to BF referrals-ext/from-bi", () => {
    const svc = read("../../services/notifyBfReferralConversion.ts");
    expect(svc).toContain('source: "bi-server"');
    expect(svc).toContain("/api/referrals-ext/from-bi");
    expect(svc).toContain("ref_code");
  });

  it("persists the raw referral code on the application at create", () => {
    const routes = read("../biPublicApplicationRoutes.ts");
    expect(routes).toContain("SET referrer_code = $1");
  });

  it("notifies BF at policy bind", () => {
    const hook = read("../pgiWebhookRoutes.ts");
    expect(hook).toContain("notifyBfReferralConversion");
    expect(hook).toContain("annual_premium");
  });

  it("no longer mounts the BI referrer self-service routes", () => {
    const server = read("../../server.ts");
    expect(server).not.toContain(
      'app.use("/api/v1", biCors, biReferrerRoutes)',
    );
  });
});
