// BI_SERVER_CLIENT_APP_ISOLATION_v362 / BI_SERVER_CONTRACT_REUPLOAD_v362
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const read = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const profile = read("biApplicantProfileRoutes.ts");
const contract = read("biApplicantContractRoutes.ts");
const selection = read("biApplicantSelectionRoutes.ts");

describe("client applications stay separate", () => {
  it("step 1 reuses only the same business, never a BF referral", () => {
    expect(profile).toContain("AND lower(trim(COALESCE(data->>'businessName', business_name, ''))) = lower(trim($2))");
    expect(profile).toContain("[phone, businessName],");
    expect(profile).toContain("AND COALESCE(source, '') <> 'bf_pgi_referral'");
  });
  it("the contract upload and the wizard's 'me' lookup skip BF referrals", () => {
    expect(contract).toContain("AND COALESCE(source, '') <> 'bf_pgi_referral' -- BI_SERVER_CLIENT_APP_ISOLATION_v362");
    expect(selection).toContain("AND COALESCE(source, '') <> 'bf_pgi_referral' -- BI_SERVER_CLIENT_APP_ISOLATION_v362");
  });
});

describe("a new contract replaces the previous one", () => {
  it("retires the old file before storing the new one", () => {
    const retire = contract.indexOf("SET purged_at = NOW()");
    const store = contract.indexOf("const stored = await getStorage().put({");
    expect(retire).toBeGreaterThan(-1);
    expect(retire).toBeLessThan(store);
    expect(contract).toContain("DELETE FROM bi_contract_requirements WHERE application_id = $1");
    expect(contract).toContain("DELETE FROM bi_application_products WHERE application_id = $1 AND source = 'contract'");
  });
});
