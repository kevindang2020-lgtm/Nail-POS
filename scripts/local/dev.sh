#!/usr/bin/env bash
# Run the API (:3000) + all four web apps together for local testing.
#   POS :5173 · Super Admin :5174 · Technician :5175 · Customer :5176
# Press Ctrl-C to stop everything.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

[ -f .env ] || { echo "No .env found — run:  bash scripts/local/setup.sh"; exit 1; }
set -a; . ./.env; set +a
export PORT="${PORT:-3000}"

docker compose up -d db >/dev/null 2>&1 || true

echo "==> Building the API…"
npm run build:api
echo "==> Starting API on :$PORT…"
node apps/api/dist/main.js & API_PID=$!
POS_PID=""; ADMIN_PID=""; TECH_PID=""; CUST_PID=""
cleanup() { echo; echo "Stopping…"; kill "$API_PID" "$POS_PID" "$ADMIN_PID" "$TECH_PID" "$CUST_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "==> Waiting for the API to report healthy…"
until curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; do sleep 1; done
echo "    API is up."

echo "==> Starting POS (:5173), Super Admin (:5174), Technician (:5175), Customer (:5176)…"
npm run dev:pos      & POS_PID=$!
npm run dev:admin    & ADMIN_PID=$!
npm run dev:tech     & TECH_PID=$!
npm run dev:customer & CUST_PID=$!

echo ""
echo "  ┌──────────────────────────────────────────────────────────┐"
echo "  │  POS:          http://localhost:5173  (owner@pilotsalon)   │"
echo "  │  Super Admin:  http://localhost:5174  (admin@aipowersalon) │"
echo "  │  Technician:   http://localhost:5175  (tech@pilotsalon)    │"
echo "  │  Customer:     http://localhost:5176  (customer@pilotsalon) │"
echo "  └──────────────────────────────────────────────────────────┘"
echo ""
echo "  Press Ctrl-C to stop everything."
wait
