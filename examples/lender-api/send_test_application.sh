#!/usr/bin/env bash
# send_test_application.sh
# Boreal Risk — pretend-to-be-a-lender smoke test.
#
# Usage:
#   export BI_LENDER_KEY="bk_test_xxxxxxxxxxxx.yyyyyyyyyyyyyyyy"
#   bash send_test_application.sh
#
# A bk_test_* key forces sandbox handling on the server: the
# application is tagged is_demo=true and the carrier call is stubbed,
# so this is safe to run any number of times. A bk_live_* key will
# create a REAL submission to the carrier.
set -euo pipefail

: "${BI_LENDER_KEY:?Set BI_LENDER_KEY first. Generate one at /lender/sandbox.}"

BI_SERVER="${BI_SERVER:-https://bi-server-cse0apamgkheb9d5.canadacentral-01.azurewebsites.net}"

read -r -d '' BODY <<'JSON' || true
{
  "company_name":     "Sandbox Test Co. Ltd.",
  "guarantor_name":   "Test Guarantor",
  "guarantor_phone":  "+15875550100",
  "guarantor_email":  "sandbox@example.com",

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
JSON

echo "POST ${BI_SERVER}/api/v1/lender/applications"
echo "  (key prefix: ${BI_LENDER_KEY%%.*})"
echo

curl --silent --show-error --include \
  -X POST "${BI_SERVER}/api/v1/lender/applications" \
  -H "Authorization: Bearer ${BI_LENDER_KEY}" \
  -H "Content-Type: application/json" \
  -d "${BODY}"

echo
echo
echo "Done. Sandbox keys (bk_test_*) stub the carrier — the response"
echo "should include pgi_application_id starting with STUB_APP_DEMO_."
echo "Live keys (bk_live_*) hit the real PGI carrier."
