#!/usr/bin/env bash
# live-api-harnesses.sh — Oct 20 2026: the harness scripts that need a RUNNING API (verify-customer-import.mjs: the bulk
# CSV import; verify-customer-display.mjs was retired — its pre-dual-screen pairing flow no longer exists, the new one is
# proven by live-pilot-day + live-display-lifecycle) run here, against the compiled API
# booted on a database the route sweep has already seeded (salon LUXE, owner@luxenails.test — the logins they default to).
#   DATABASE_URL=postgres://…/fr_live bash tooling/ci/live-api-harnesses.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT/apps/api"
: "${DATABASE_URL:?DATABASE_URL (a migrated database the route sweep seeded) is required}"
PORT="${LIVE_HARNESS_PORT:-3017}"
LOG="$(mktemp -t live-api-harness.XXXXXX)"
PAYMENTS_SANDBOX=1 REPO_DRIVER=postgres NODE_ENV=development AUTH_SESSION_SECRET=live-harness-secret-0123456789abcdef \
  PORT="$PORT" DATABASE_URL="$DATABASE_URL" node dist/main.js > "$LOG" 2>&1 &
API=$!
trap 'kill $API 2>/dev/null; wait $API 2>/dev/null' EXIT
for i in $(seq 1 120); do curl -s -o /dev/null "http://127.0.0.1:$PORT/health/live" && break; sleep 0.5; done
curl -s -o /dev/null "http://127.0.0.1:$PORT/health/live" || { echo "API did not start"; tail -40 "$LOG"; exit 1; }
# the import runs at a size that keeps the lane short; ROWS=50000 is the scale proof the script documents
HARNESS_API_BASE="http://127.0.0.1:$PORT" ROWS="${ROWS:-5000}" bash scripts/run-harnesses.sh customer-import.mjs
rc=$?
[ $rc -eq 0 ] || { echo "── API log (errors) ──"; grep -E '"level":"(error|fatal)"' "$LOG" | tail -10 | cut -c1-600; }
exit $rc
