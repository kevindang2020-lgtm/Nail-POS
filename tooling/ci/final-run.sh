#!/usr/bin/env bash
# final-run.sh — mandate §236/§237 (Oct 20 2026): ONE logged run of every lane. Every number in the status reports is copied
# from this run's log (final-run/summary.txt), never from memory or an earlier run. Each lane records its own rc; the
# script never stops early, so the summary shows every lane's real result (a FAIL stays a FAIL).
#
#   PG_URL=postgres://postgres@localhost:5432  bash tooling/ci/final-run.sh
#
# Needs: node 22, a local PostgreSQL 16 the script may create databases on (fresh databases: fr_migrate, fr_race, fr_live),
# Chromium for the browser proofs (pilot day screenshots, e2e:html).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
OUT="${FINAL_RUN_OUT:-$ROOT/final-run}"; mkdir -p "$OUT"; SUMMARY="$OUT/summary.txt"; : > "$SUMMARY"
PG_URL="${PG_URL:-postgres://postgres@localhost:5432}"
export TZ=UTC
stamp() { date -u +%H:%M:%S; }
say() { echo "$(stamp) $*" | tee -a "$SUMMARY"; }
# lane <name> <logfile> <command...>: run, capture, record rc + the last summary-ish line
lane() {
  local name="$1" log="$OUT/$2"; shift 2
  say "START $name"
  ( "$@" ) > "$log" 2>&1; local rc=$?
  local tail; tail="$(grep -E 'Tests |Test Files|passed|PASS|FAIL|OK|rc=|checks|routes|gates|complete|applied|error TS' "$log" | tail -3 | tr '\n' ' | ' | cut -c1-300)"
  say "END   $name rc=$rc :: $tail"
  return $rc
}
db() { psql "$PG_URL/postgres" -qc "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1; psql "$PG_URL/postgres" -qc "CREATE DATABASE $1" >/dev/null; echo "$PG_URL/$1"; }

say "final run — commit $(git rev-parse --short HEAD) ($(git log -1 --format=%ci)) — node $(node -v)"
say "git status: $(git status --short | wc -l) uncommitted file(s)"

# 1. clean install
lane install                 01-install.log                 npm ci --no-audit --no-fund
# 2. migrations on a FRESH database
MIG_DB="$(db fr_migrate)"
lane migrations-fresh        02-migrations.log              env MIGRATE_DATABASE_URL="$MIG_DB" node apps/api/scripts/migrate.mjs
# 3. builds
lane build-packages          03-build-packages.log          npm run -s build:packages
lane build-modules           04-build-modules.log           npm run -s build:modules
lane build-api               05-build-api.log               npm run -s build:api
lane build-frontends         06-build-frontends.log         npm run -s build:frontends
# 4. typecheck + lint
lane typecheck-api           07-typecheck.log               npm run -s typecheck
lane lint                    08-lint.log                    node tooling/ci/lint-ratchet.mjs
# 5. gates + audits (every check:* incl. supply-chain-injection R7, secrets, boot)
lane gates                   09-gates.log                   npm run -s ci:gates
# 6. unit / pgtest lanes
lane tests-packages          10-tests-packages.log          npm run -s ci:test:packages
lane tests-modules           11-tests-modules.log           npm run -s ci:test:modules
lane tests-apps              12-tests-apps.log              npm run -s ci:test:apps
lane tests-api               13-tests-api.log               npm run -s ci:test:api
# harnesses: scripts that need a migrated PostgreSQL get a fresh one (HARNESS_DATABASE_URL); the one that needs a running API (customer import)
# run later beside the route sweep (live-api-harnesses) — here it reports SKIPPED, never passed
HARNESS_DB="$(db fr_harness)"
lane migrations-harness      14a-migrations-harness.log     env MIGRATE_DATABASE_URL="$HARNESS_DB" node apps/api/scripts/migrate.mjs
lane harnesses               14-harnesses.log               bash -c "cd apps/api && HARNESS_DATABASE_URL='$HARNESS_DB' npm run -s test:harness"
# 7. real-Postgres race lane on a FRESH migrated database (now incl. refund-race, booking-time-off, check-in replica retry, job hold)
RACE_DB="$(db fr_race)"
lane migrations-race         15-migrations-race.log         env MIGRATE_DATABASE_URL="$RACE_DB" node apps/api/scripts/migrate.mjs
lane race-lane               16-race.log                    env PG_RACE_URL="$RACE_DB" npm run -s ci:test:race
# 8. live proofs on a booted API + scratch database (seeded by the sweep)
LIVE_DB="$(db fr_live)"
lane migrations-live         17-migrations-live.log         env MIGRATE_DATABASE_URL="$LIVE_DB" node apps/api/scripts/migrate.mjs
lane live-route-sweep        18-route-sweep.log             env DATABASE_URL="$LIVE_DB" node apps/api/scripts/live-route-sweep.mjs
lane live-api-harnesses      18a-live-api-harnesses.log     env DATABASE_URL="$LIVE_DB" bash tooling/ci/live-api-harnesses.sh
# event wiring drives the PILOT01 flow proofs (live-fair-turn, live-money-chain, …): it needs the demo seed with its DEFAULT
# owner / super-admin logins, which live-route-sweep does NOT create (it seeds LUXE / PALACE with its own passwords).
lane seed-pilot01            19a-seed-pilot01.log           bash -c "cd apps/api && for s in seed.ts seed-demo.ts seed-local-accounts.ts; do DATABASE_URL='$LIVE_DB' SEED_TENANT_CODE=PILOT01 SEED_FRONTDESK_EMAIL=frontdesk@pilot.test SEED_TECH_EMAIL=tech@pilot.test SEED_CUSTOMER_EMAIL=customer@pilot.test npx tsx scripts/\$s || exit 1; done"
lane live-event-wiring       19-event-wiring.log            env DATABASE_URL="$LIVE_DB" EVENT_PUBLISHER_ENABLED=1 node apps/api/scripts/live-event-wiring.mjs
lane live-display-lifecycle  19c-display-lifecycle.log      bash -c "cd apps/api && DATABASE_URL='$LIVE_DB' SALON_CODE=PILOT01 OWNER_EMAIL=owner@pilotsalon.com OWNER_PASSWORD='ChangeMe!Owner1' node scripts/live-display-lifecycle.mjs"
PILOT_DB="$(db fr_pilot)"
lane migrations-pilot        20-migrations-pilot.log        env MIGRATE_DATABASE_URL="$PILOT_DB" node apps/api/scripts/migrate.mjs
lane live-pilot-day          21-pilot-day.log               bash -c "cd apps/api && DATABASE_URL='$PILOT_DB' PORT_PROOF=3201 PILOT_SHOTS='$OUT/pilot-shots' PILOT_OUT='$OUT/pilot.json' node scripts/live-pilot-day.mjs"
# the drill decrypts what the PILOT API sealed: same key material (non-production keys derive from AUTH_SESSION_SECRET,
# which live-pilot-day.mjs sets to exactly this value)
lane drill-restore           22-drill-restore.log           bash -c "cd apps/api && AUTH_SESSION_SECRET=live-proof-session-secret-0123456789abcdef DRILL_DATABASE_URL='$PILOT_DB' DATABASE_URL='$PILOT_DB' node scripts/drills/drill-restore.mjs"
lane e2e-html                23-e2e-html.log                bash -c 'cd apps/api && npm run -s e2e:html'
say "DONE — see $SUMMARY"
grep -c 'rc=0' "$SUMMARY" | xargs -I{} say "lanes rc=0: {} of $(grep -c '^.* END ' "$SUMMARY")"
