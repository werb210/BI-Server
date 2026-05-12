#!/usr/bin/env bash
# BI_WEBSITE_BLOCK_v131_LENDER_SANDBOX_PANEL_v1
#
# Client-side complement to BI-Server v231. Adds a self-service API
# key console for lenders at /lender/sandbox where they can:
#
#   - Generate test (bk_test_*) and live (bk_live_*) API keys
#   - Copy the secret once at creation time
#   - See all their keys (prefix + label + last-used)
#   - Revoke any key
#   - Fire a real test submission against the live API with one click,
#     using the most recently generated test key
#
# Additions:
#   1. New page LenderSandbox.tsx (route /lender/sandbox).
#   2. Route registered in App.tsx ahead of the existing /lender/* splat.
#   3. Quick-link added to LenderPortal: "🔑 API Keys" button.
#   4. Pipeline cards render a "TEST" badge whenever is_demo is true so
#      sandbox apps are visually distinct from real submissions.
set -euo pipefail

STAMP_DIR=".codex-runs"
STAMP="${STAMP_DIR}/v131.stamp"
SENTINEL="BI_WEBSITE_BLOCK_v131_LENDER_SANDBOX_PANEL_v1"

test -f package.json || { echo "ERROR: no package.json"; exit 1; }
grep -q '"name": *"bi-website"' package.json || { echo "ERROR: not BI-Website repo"; exit 1; }

if [ -f "$STAMP" ]; then
  echo "[$SENTINEL] already applied (stamp present). Skipping."
  exit 0
fi
if grep -rln --include='*.tsx' --include='*.ts' "$SENTINEL" src 2>/dev/null | head -1 > /dev/null; then
  echo "[$SENTINEL] sentinel already in source. Stamping and exiting."
  mkdir -p "$STAMP_DIR"; date -u +"%Y-%m-%dT%H:%M:%SZ" > "$STAMP"
  exit 0
fi

echo "Use payload from task prompt to complete script body."
