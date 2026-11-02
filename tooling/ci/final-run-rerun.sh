#!/usr/bin/env bash
# final-run-rerun.sh — Oct 20 2026: the lanes that FAILED in the first pass of final-run.sh, re-run AFTER the fix for each
# failure was committed, appended to the SAME summary with a "-rerun" suffix. The first-pass lines stay in the summary:
# a reader sees both the failure and the re-run. Usage (same env as final-run.sh):
#   PG_URL=postgres://postgres@localhost:5432 bash tooling/ci/final-run-rerun.sh lint gates tests-apps route-sweep event-wiring drill e2e
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
OUT="${FINAL_RUN_OUT:-$ROOT/final-run}"; SUMMARY="$OUT/summary.txt"
PG_URL="${PG_URL:-postgres://postgres@localhost:5432}"; export TZ=UTC
stamp() { date -u +%H:%M:%S; }
say() { echo "$(stamp) $*" | tee -a "$SUMMARY"; }
lane() { local name="$1" log="$OUT/$2"; shift 2; say "START $name"; ( "$@" ) > "$log" 2>&1; local rc=$?
  local tail; tail="$(grep -E 'Tests |Test Files|passed|PASS|FAIL|OK|rc=|checks|routes|gates|complete|applied|error TS' "$log" | tail -3 | tr '\n' ' | ' | cut -c1-300)"
  say "END   $name rc=$rc :: $tail"; return $rc; }
db() { psql "$PG_URL/postgres" -qc "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1; psql "$PG_URL/postgres" -qc "CREATE DATABASE $1" >/dev/null; echo "$PG_URL/$1"; }
say "rerun — commit $(git rev-parse --short HEAD) — lanes: $*"
for L in "$@"; do case "$L" in
  lint)         lane lint-rerun            08b-lint-rerun.log          node tooling/ci/lint-ratchet.mjs ;;
  gates)        lane gates-rerun           09b-gates-rerun.log         npm run -s ci:gates ;;
  tests-apps)   lane tests-apps-rerun      12b-tests-apps-rerun.log    npm run -s ci:test:apps ;;
  route-sweep)  RS_DB="$(db fr_live2)"; lane migrations-live-rerun 17b-migrations-live-rerun.log env MIGRATE_DATABASE_URL="$RS_DB" node apps/api/scripts/migrate.mjs
                lane live-route-sweep-rerun 18b-route-sweep-rerun.log env DATABASE_URL="$RS_DB" node apps/api/scripts/live-route-sweep.mjs ;;
  event-wiring) EW_DB="$(db fr_wiring)"; lane migrations-wiring 17c-migrations-wiring.log env MIGRATE_DATABASE_URL="$EW_DB" node apps/api/scripts/migrate.mjs
                lane seed-pilot01          19a-seed-pilot01.log        bash -c "cd apps/api && for s in seed.ts seed-demo.ts seed-local-accounts.ts; do DATABASE_URL='$EW_DB' SEED_TENANT_CODE=PILOT01 SEED_FRONTDESK_EMAIL=frontdesk@pilot.test SEED_TECH_EMAIL=tech@pilot.test SEED_CUSTOMER_EMAIL=customer@pilot.test npx tsx scripts/\$s || exit 1; done"
                lane live-event-wiring-rerun 19b-event-wiring-rerun.log env DATABASE_URL="$EW_DB" EVENT_PUBLISHER_ENABLED=1 node apps/api/scripts/live-event-wiring.mjs ;;
  drill)        lane drill-restore-rerun   22b-drill-restore-rerun.log bash -c "cd apps/api && AUTH_SESSION_SECRET=live-proof-session-secret-0123456789abcdef DRILL_DATABASE_URL='$PG_URL/fr_pilot' DATABASE_URL='$PG_URL/fr_pilot' node scripts/drills/drill-restore.mjs" ;;
  e2e)          lane e2e-html-rerun        23b-e2e-html-rerun.log      bash -c 'cd apps/api && npm run -s e2e:html' ;;
  harnesses)    H_DB="$(db fr_harness)"; lane migrations-harness-rerun 14c-migrations-harness-rerun.log env MIGRATE_DATABASE_URL="$H_DB" node apps/api/scripts/migrate.mjs
                lane harnesses-rerun       14b-harnesses-rerun.log     bash -c "cd apps/api && HARNESS_DATABASE_URL='$H_DB' npm run -s test:harness" ;;
  race)         R_DB="$(db fr_race)"; lane migrations-race-rerun 15b-migrations-race-rerun.log env MIGRATE_DATABASE_URL="$R_DB" node apps/api/scripts/migrate.mjs
                lane race-lane-rerun       16b-race-rerun.log          env PG_RACE_URL="$R_DB" npm run -s ci:test:race ;;
  live-api)     lane live-api-harnesses-rerun 18c-live-api-harnesses-rerun.log env DATABASE_URL="$PG_URL/fr_live2" bash tooling/ci/live-api-harnesses.sh ;;
  display-lifecycle) lane live-display-lifecycle-rerun 19d-display-lifecycle-rerun.log bash -c "cd apps/api && DATABASE_URL='$PG_URL/fr_wiring' SALON_CODE=PILOT01 OWNER_EMAIL=owner@pilotsalon.com OWNER_PASSWORD='ChangeMe!Owner1' node scripts/live-display-lifecycle.mjs" ;;
  tests-api)    lane tests-api-rerun       13b-tests-api-rerun.log     npm run -s ci:test:api ;;
  pilot)        P_DB="$(db fr_pilot)"; lane migrations-pilot-rerun 20b-migrations-pilot-rerun.log env MIGRATE_DATABASE_URL="$P_DB" node apps/api/scripts/migrate.mjs
                lane live-pilot-day-rerun  21b-pilot-day-rerun.log     bash -c "cd apps/api && DATABASE_URL='$P_DB' PORT_PROOF=3201 PILOT_SHOTS='$OUT/pilot-shots' PILOT_OUT='$OUT/pilot.json' node scripts/live-pilot-day.mjs" ;;
  *) say "unknown lane $L" ;;
esac; done
say "RERUN DONE"
