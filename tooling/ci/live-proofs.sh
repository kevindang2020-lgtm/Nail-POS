#!/usr/bin/env bash
# live-proofs.sh — Oct 22 2026 (deep-scan / pilot handoff mandate §9, §124): every live proof that final-run.sh does NOT run
# (final-run.sh runs live-route-sweep, live-event-wiring — which itself drives the money chain, Fair Turn, multi-technician,
# payroll, multibranch, phone, booking-verification and queue proofs — live-display-lifecycle and live-pilot-day). Each proof
# gets its OWN fresh database: migrated, then seeded with the PILOT01 salon exactly as final-run.sh seeds it, and the proof boots
# the built API (apps/api/dist) itself. Results are appended to <out>/summary.txt in the same START / END rc=… format; the
# script never stops early, so every proof's real result is recorded (a FAIL stays a FAIL).
#
#   PG_URL=postgres://postgres:<password>@localhost:5432  bash tooling/ci/live-proofs.sh [proof-name …]
#
# Needs: node 22, the API + packages built (npm run build:packages && npm run build:modules && npm run build:api), a local
# PostgreSQL 16 the script may create databases on (lp_<proof>), Chromium for the *-browser proofs (CHROMIUM_PATH, default
# /opt/pw-browsers/chromium). With no proof names it runs all of them.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
OUT="${FINAL_RUN_OUT:-$ROOT/final-run}"; mkdir -p "$OUT"; SUMMARY="$OUT/summary.txt"
PG_URL="${PG_URL:-postgres://postgres@localhost:5432}"
export TZ=UTC CHROMIUM_PATH="${CHROMIUM_PATH:-/opt/pw-browsers/chromium}"
say() { echo "$(date -u +%H:%M:%S) $*" | tee -a "$SUMMARY"; }
db() { psql "$PG_URL/postgres" -qc "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1; psql "$PG_URL/postgres" -qc "CREATE DATABASE $1" >/dev/null; echo "$PG_URL/$1"; }
seeded() {   # a fresh database with the PILOT01 salon and its default logins (the proofs sign in with them)
  local url; url="$(db "$1")"
  MIGRATE_DATABASE_URL="$url" node apps/api/scripts/migrate.mjs >/dev/null 2>&1 || return 1
  ( cd apps/api && for s in seed.ts seed-demo.ts seed-local-accounts.ts; do DATABASE_URL="$url" SEED_TENANT_CODE=PILOT01 SEED_FRONTDESK_EMAIL=frontdesk@pilot.test SEED_TECH_EMAIL=tech@pilot.test SEED_CUSTOMER_EMAIL=customer@pilot.test npx tsx "scripts/$s" >/dev/null 2>&1 || exit 1; done ) || return 1
  echo "$url"
}
# proofs that take a migrated + PILOT01-seeded DATABASE_URL
SEEDED=(live-checkout-one-payment live-display-ads live-display-23in-browser live-display-ads-browser live-display-checkin-browser
  live-display-devices-browser live-display-journeys-browser live-local-day live-phase10-database live-phase12-async live-phase12-v1
  live-phase13-app-version live-phase13-native-realtime live-phase14-telemetry live-phase2-foundations live-phase5-deals
  live-phase7-scheduling live-phase8-community-browser live-phase9-permissions live-pos-autolock live-refresh-authorization live-tracing
  live-rls-trial live-phase13-offline)
# proofs that run against the server's bare `postgres` database (none today: live-rls-trial COPIES its DATABASE_URL and
# live-phase13-offline seeds into it, so both need a migrated + seeded source — Oct 22 2026, both failed on the bare one)
SERVER=()
want() { [ "$#" -eq 0 ] && return 0; return 1; }
SEL=("$@")
pick() { local n="$1"; [ "${#SEL[@]}" -eq 0 ] && return 0; for s in "${SEL[@]}"; do [ "$s" = "$n" ] && return 0; done; return 1; }
say "live proofs — commit $(git rev-parse --short HEAD) — node $(node -v)"
# the display browser proofs serve apps/pos-web/dist (vite preview) and live-display-devices-browser checks the POS offers
# "Open on second screen", which needs VITE_CUSTOMER_DISPLAY_URL at BUILD time (its header: http://127.0.0.1:4177) — build the
# POS once like that (dist is a local build output; nothing tracked changes). The customer display is built as-is.
if pick live-display-devices-browser || pick live-display-journeys-browser || pick live-display-checkin-browser; then
  ( cd apps/pos-web && VITE_CUSTOMER_DISPLAY_URL=http://127.0.0.1:4177 npx vite build ) > "$OUT/lp-build-pos-web.log" 2>&1 && ( cd apps/customer-display && npx vite build ) >> "$OUT/lp-build-pos-web.log" 2>&1
  say "pos-web + customer-display built for the display proofs rc=$?"
fi
if pick live-phase13-offline; then   # it serves the BUILT tech-web bundle
  ( cd apps/tech-web && npx vite build ) > "$OUT/lp-build-tech-web.log" 2>&1
  say "tech-web built for live-phase13-offline rc=$?"
fi
for p in "${SEEDED[@]}"; do
  pick "$p" || continue
  say "START $p"
  url="$(seeded "lp_${p//-/_}")" || { say "END   $p rc=2 :: could not migrate / seed its database"; continue; }
  ( cd apps/api && DATABASE_URL="$url" SALON_CODE=PILOT01 OWNER_EMAIL=owner@pilotsalon.com OWNER_PASSWORD='ChangeMe!Owner1' SHOTS="$OUT/shots-$p" node "scripts/$p.mjs" ) > "$OUT/lp-$p.log" 2>&1; rc=$?
  say "END   $p rc=$rc :: $(grep -E 'checks passed|passed|PASS \(|FAIL|live checks' "$OUT/lp-$p.log" | tail -1 | cut -c1-200)"
done
for p in "${SERVER[@]+"${SERVER[@]}"}"; do
  pick "$p" || continue
  say "START $p"
  ( cd apps/api && DATABASE_URL="$PG_URL/postgres" node "scripts/$p.mjs" ) > "$OUT/lp-$p.log" 2>&1; rc=$?
  say "END   $p rc=$rc :: $(grep -E 'checks passed|passed|PASS \(|FAIL' "$OUT/lp-$p.log" | tail -1 | cut -c1-200)"
done
say "LIVE PROOFS DONE"
