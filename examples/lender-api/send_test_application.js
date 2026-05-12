// send_test_application.js
// Boreal Risk — pretend-to-be-a-lender smoke test (Node.js, no deps).
//
// Usage:
//   export BI_LENDER_KEY="bk_test_xxxxxxxxxxxx.yyyyyyyyyyyyyyyy"
//   node send_test_application.js
//
// Requires Node 18+ (uses the built-in fetch). A bk_test_* key forces
// sandbox handling server-side; the carrier call is stubbed and the
// application appears in your pipeline with a TEST tag. Safe to re-run.

const KEY = process.env.BI_LENDER_KEY;
if (!KEY) {
  console.error("Set BI_LENDER_KEY first. Generate one at /lender/sandbox.");
  process.exit(1);
}

const SERVER = process.env.BI_SERVER
  ?? "https://bi-server-cse0apamgkheb9d5.canadacentral-01.azurewebsites.net";

const body = {
  // Identification — appears as the row label in your pipeline.
  company_name:    "Sandbox Test Co. Ltd.",
  guarantor_name:  "Test Guarantor",
  guarantor_phone: "+15875550100",
  guarantor_email: "sandbox@example.com",

  // PGI form_data — required by the carrier schema.
  country:              "CA",
  naics_code:           "541511",
  formation_date:       "2022-01-15",
  loan_amount:          500000,
  pgi_limit:            400000,
  annual_revenue:       3000000,
  ebitda:               400000,
  total_debt:           600000,
  monthly_debt_service: 7800,
  collateral_value:     1200000,
  enterprise_value:     20000000,
  bankruptcy_history:   false,
  insolvency_history:   false,
  judgment_history:     false,
};

(async () => {
  const url = `${SERVER}/api/v1/lender/applications`;
  console.log(`POST ${url}`);
  console.log(`  (key prefix: ${KEY.split(".")[0]})`);

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  console.log(`\nHTTP ${res.status} ${res.statusText}`);
  console.log("x-request-id:", res.headers.get("x-request-id") ?? "(none)");
  console.log(JSON.stringify(data, null, 2));

  if (res.ok && data.pgi_application_id?.startsWith("STUB_APP_DEMO_")) {
    console.log("\n✓ Sandbox submission confirmed — carrier was stubbed.");
  } else if (res.ok) {
    console.log("\n! Live submission — carrier was hit. Check the PGI dashboard.");
  } else {
    console.log("\n✗ Request failed. See response above.");
    process.exit(1);
  }
})().catch((e) => {
  console.error("Network error:", e?.message ?? e);
  process.exit(1);
});
