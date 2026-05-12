#!/usr/bin/env python3
# send_test_application.py
# Boreal Risk — pretend-to-be-a-lender smoke test (Python 3 + requests).
#
# Usage:
#   export BI_LENDER_KEY="bk_test_xxxxxxxxxxxx.yyyyyyyyyyyyyyyy"
#   pip install requests   # if needed
#   python send_test_application.py
#
# A bk_test_* key forces sandbox handling server-side; the carrier
# call is stubbed and the application appears in your pipeline with
# a TEST tag. Safe to re-run.

import os
import sys
import json

try:
    import requests
except ImportError:
    print("This script needs the 'requests' package. Run: pip install requests")
    sys.exit(1)

KEY = os.environ.get("BI_LENDER_KEY")
if not KEY:
    print("Set BI_LENDER_KEY first. Generate one at /lender/sandbox.")
    sys.exit(1)

SERVER = os.environ.get(
    "BI_SERVER",
    "https://bi-server-cse0apamgkheb9d5.canadacentral-01.azurewebsites.net",
)

body = {
    # Identification — appears as the row label in your pipeline.
    "company_name":    "Sandbox Test Co. Ltd.",
    "guarantor_name":  "Test Guarantor",
    "guarantor_phone": "+15875550100",
    "guarantor_email": "sandbox@example.com",

    # PGI form_data — required by the carrier schema.
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
    "bankruptcy_history":   False,
    "insolvency_history":   False,
    "judgment_history":     False,
}

url = f"{SERVER}/api/v1/lender/applications"
print(f"POST {url}")
print(f"  (key prefix: {KEY.split('.')[0]})")

try:
    res = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type":  "application/json",
        },
        json=body,
        timeout=30,
    )
except requests.RequestException as e:
    print(f"Network error: {e}")
    sys.exit(1)

try:
    data = res.json()
except ValueError:
    data = {"raw": res.text}

print(f"\nHTTP {res.status_code} {res.reason}")
print(f"x-request-id: {res.headers.get('x-request-id', '(none)')}")
print(json.dumps(data, indent=2))

if res.ok and isinstance(data.get("pgi_application_id"), str) and data["pgi_application_id"].startswith("STUB_APP_DEMO_"):
    print("\n✓ Sandbox submission confirmed — carrier was stubbed.")
elif res.ok:
    print("\n! Live submission — carrier was hit. Check the PGI dashboard.")
else:
    print("\n✗ Request failed. See response above.")
    sys.exit(1)
