#!/usr/bin/env bash
# run-e2e-moneypath.sh — provision a DB, migrate, seed, boot the API on Postgres,
# run the e2e money-path driver, and tear down. Exits non-zero if any check fails.
#
# Two modes:
#   CI / external DB:  set DATABASE_URL=postgres://...  (e.g. a Postgres service container).
#                      Migrations + seed are idempotent, so re-runs are safe; the DB is NOT dropped.
#   Local throwaway:   DATABASE_URL unset + running as root with PostgreSQL installed ->
#                      a fresh local cluster + fresh DB are created under a temp dir and removed after.
#
# Usage:  bash scripts/run-e2e-moneypath.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"          # monorepo root (aipowersalon-pos)
API="$ROOT/apps/api"
MIG="$API/db/migrations"
PORT="${E2E_API_PORT:-3001}"
SECRET="e2e-test-only-secret-$(date +%s)-aipowersalon-money-path-check"

# seed + driver must agree on these
export SEED_SUPER_ADMIN_EMAIL="${SEED_SUPER_ADMIN_EMAIL:-admin@e2e.local}"
export SEED_SUPER_ADMIN_PASSWORD="${SEED_SUPER_ADMIN_PASSWORD:-E2e!SuperAdmin1}"
export SEED_TENANT_CODE="${SEED_TENANT_CODE:-PILOT01}"
export SEED_OWNER_EMAIL="${SEED_OWNER_EMAIL:-owner@e2e.local}"
export SEED_OWNER_PASSWORD="${SEED_OWNER_PASSWORD:-E2e!Owner1}"
export E2E_SALON_CODE="$SEED_TENANT_CODE"
export E2E_OWNER_EMAIL="$SEED_OWNER_EMAIL"
export E2E_OWNER_PASSWORD="$SEED_OWNER_PASSWORD"
export E2E_BASE_URL="http://127.0.0.1:$PORT"

API_PID=""; PG_LOCAL=0; PGDATA=""; PGBIN=""
cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  if [ "$PG_LOCAL" = "1" ] && [ -n "$PGBIN" ] && [ -n "$PGDATA" ]; then
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA stop" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

log(){ echo "── $*"; }

# ---- 1. database -----------------------------------------------------------
if [ -z "${DATABASE_URL:-}" ]; then
  log "no DATABASE_URL: provisioning a local throwaway Postgres"
  PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  [ -z "$PGBIN" ] && { echo "ERROR: PostgreSQL not installed and DATABASE_URL unset"; exit 3; }
  PGDATA="$(mktemp -d)/pgdata"; mkdir -p "$PGDATA"; chown -R postgres:postgres "$(dirname "$PGDATA")"
  su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null 2>&1
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-p 5433 -k /tmp' -l /tmp/e2e-pg.log start" >/dev/null 2>&1
  PG_LOCAL=1; sleep 2
  su postgres -c "$PGBIN/psql -p 5433 -h /tmp -U postgres -c 'DROP DATABASE IF EXISTS aps_e2e;'" >/dev/null 2>&1
  su postgres -c "$PGBIN/psql -p 5433 -h /tmp -U postgres -c 'CREATE DATABASE aps_e2e;'" >/dev/null 2>&1
  export DATABASE_URL="postgresql://postgres@127.0.0.1:5433/aps_e2e"
else
  log "using provided DATABASE_URL (migrations + seed are idempotent; DB not dropped)"
fi
PSQL_BASE="${PGBIN:+$PGBIN/}psql"

# ---- 2. migrations (ascending filename order) ------------------------------
log "applying $(ls "$MIG"/*.sql | wc -l) migrations"
for f in $(ls "$MIG"/*.sql | sort); do
  $PSQL_BASE "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" || { echo "ERROR applying $(basename "$f")"; exit 4; }
done

# ---- 3. deps + build -------------------------------------------------------
[ -d "$ROOT/node_modules" ] || { log "npm install"; (cd "$ROOT" && npm install --no-fund --no-audit >/dev/null); }
[ -f "$API/dist/main.js" ] || { log "building api"; (cd "$ROOT" && npm run build --workspace @aipowersalon/api >/dev/null); }

# ---- 4. seed ---------------------------------------------------------------
log "seeding (super-admin + tenant $SEED_TENANT_CODE + owner)"
(cd "$ROOT" && DATABASE_URL="$DATABASE_URL" npm run seed --workspace @aipowersalon/api >/dev/null) \
  || { echo "ERROR: seed failed"; exit 5; }

# ---- 5. boot API on Postgres ----------------------------------------------
log "booting API on :$PORT (REPO_DRIVER=postgres)"
( cd "$API" && REPO_DRIVER=postgres DATABASE_URL="$DATABASE_URL" \
    AUTH_SESSION_SECRET="$SECRET" NODE_ENV=development PORT="$PORT" \
    node dist/main.js >/tmp/e2e-api.log 2>&1 ) &
API_PID=$!
for i in $(seq 1 40); do
  curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { log "API healthy"; break; }
  sleep 0.5
  [ "$i" = "40" ] && { echo "ERROR: API did not become healthy"; tail -20 /tmp/e2e-api.log; exit 6; }
done

# ---- 6. drive + assert -----------------------------------------------------
echo ""
python3 "$ROOT/scripts/e2e_moneypath.py"
RC=$?
echo ""
log "e2e driver exit: $RC"
exit $RC
