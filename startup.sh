#!/usr/bin/env bash
# BI_BOOT_FIX_v63_STARTUP_SH — Azure runs THIS, not node directly. The
# echo lines below are the first log entries after Azure spawns the
# container. If you see "[startup.sh] begin" in the Azure log stream
# and then nothing, node itself crashed — check the lines after.
# If you don't see "[startup.sh] begin" at all, Azure isn't using this
# script — check Configuration > General Settings > Startup Command.

set -e

echo "[startup.sh] begin $(date -u +%FT%TZ) build=${BUILD_TAG:-unknown} sha=${COMMIT_SHA:-unknown}"
echo "[startup.sh] cwd=$(pwd) node=$(node --version) npm=$(npm --version 2>/dev/null || echo 'n/a')"
echo "[startup.sh] PORT=${PORT:-unset} NODE_ENV=${NODE_ENV:-unset}"

# Azure App Service Linux mounts the deploy at /home/site/wwwroot.
cd /home/site/wwwroot 2>/dev/null || cd "$(dirname "$0")"

if [ ! -f "dist/index.js" ]; then
  echo "[startup.sh] FATAL: dist/index.js not found in $(pwd)"
  echo "[startup.sh] dir listing:"
  ls -la
  echo "[startup.sh] dist/ listing:"
  ls -la dist 2>/dev/null || echo "(no dist/)"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[startup.sh] WARN: node_modules missing — running npm install (this should never happen on Azure with proper deploy)"
  npm install --omit=dev --no-audit --no-fund || true
fi

echo "[startup.sh] launching node dist/index.js"
exec node dist/index.js
