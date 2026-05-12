# Boreal Risk — Lender API examples

Ready-to-run "pretend to be a lender" scripts. Pick whichever language
your team uses. All three send an identical, schema-valid application
to the **production** `bi-server` host. The only thing that decides
whether the carrier is hit is the **prefix on your API key**:

| Key prefix    | Behaviour                                              |
|---------------|--------------------------------------------------------|
| `bk_test_...` | Sandbox. App appears in your pipeline tagged TEST. Carrier call is auto-stubbed. **You can run this any number of times safely.** |
| `bk_live_...` | Production. Real PGI submission. Treat like a password. |

Generate keys yourself at <https://witty-moss-0886d220f.7.azurestaticapps.net/lender/sandbox>
(or your custom domain once mapped). The secret is shown **once at
creation time** — we store only a hash, so copy it then or generate a
new one.

---

## Quick start (curl, ~10 seconds)

```bash
export BI_LENDER_KEY="bk_test_xxxxxxxxxxxx.yyyyyyyyyyyyyyyy"  # paste yours
bash send_test_application.sh
```

Expected output on success:

```
HTTP/2 201
{
  "id": "...",
  "application_code": "BI-XXXXXX",
  "pgi_application_id": "STUB_APP_DEMO_1747...",
  "status": "new_application",
  ...
}
```

`STUB_APP_DEMO_*` confirms the carrier call was stubbed because your
key is a `bk_test_` sandbox key. If you see a real PGI id back, you
sent a live key — go check the carrier dashboard, that submission was
real.

---

## Node.js

```bash
export BI_LENDER_KEY="bk_test_xxx.yyy"
node send_test_application.js
```

Node 18+ required (uses the built-in `fetch`).

## Python

```bash
export BI_LENDER_KEY="bk_test_xxx.yyy"
pip install requests   # if needed
python send_test_application.py
```

---

## What the body looks like

Every script sends the same minimal valid body. The 14 PGI carrier
fields are required; the four identification fields are required by our
own router so we can put the right name on the row in your pipeline.

```jsonc
{
  // Identification — used to label the row in your pipeline
  "company_name":     "Sandbox Test Co. Ltd.",
  "guarantor_name":   "Test Guarantor",
  "guarantor_phone":  "+15875550100",
  "guarantor_email":  "sandbox@example.com",

  // PGI form_data — required by the carrier schema
  "country":              "CA",
  "naics_code":           "541511",
  "formation_date":       "2022-01-15",
  "loan_amount":          500000,
  "pgi_limit":            400000,
  "annual_revenue":       3000000,
  "ebitda":               400000,
  "total_debt":           600000,
  "monthly_debt_service": 7800,
  "collateral_value":     1200000,
  "enterprise_value":     20000000,
  "bankruptcy_history":   false,
  "insolvency_history":   false,
  "judgment_history":     false
}
```

Add any of the optional fields from <https://boreal.financial/lender/api>
(guarantor DOB, business address, NAICS detail, doc URLs, etc.) to
make the submission richer. None of them are required at the API
boundary — staff and the carrier will follow up if anything material
is missing.

---

## Verifying it landed

After a 201, the application appears within seconds in your pipeline
at <https://witty-moss-0886d220f.7.azurestaticapps.net/lender/portal>.
Sandbox rows are tagged with a yellow `TEST` chip.

If you'd rather poll the API:

```bash
curl -H "Authorization: Bearer $BI_LENDER_KEY" \
  https://bi-server-cse0apamgkheb9d5.canadacentral-01.azurewebsites.net/api/v1/lender/applications/mine
```

---

## Troubleshooting

| HTTP | Likely cause                                         | Fix                                                   |
|------|------------------------------------------------------|-------------------------------------------------------|
| 400  | `missing_fields` — required PGI field omitted        | Inspect the response `fields` array; add them.        |
| 401  | `missing_api_key` / `invalid_api_key`                | `BI_LENDER_KEY` not exported, or key was revoked.     |
| 403  | not your application (only relevant on GETs)         | Make sure the key belongs to the same lender row.     |
| 500  | server error                                         | Send us the `x-request-id` response header.           |

Reach `hello@boreal.financial` with the `x-request-id` of any failure
and we'll pull the server log.
