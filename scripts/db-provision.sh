#!/usr/bin/env bash
# db-provision.sh — make a local Postgres ready for AIPowerSalon on PG16.
# Ensures the app role exists AND owns the `public` schema, which PG16 no longer grants to
# non-owner roles by default (the cause of "permission denied for schema public" on a fresh DB).
# Safe to run repeatedly. Docker users don't need this (the image makes the app user the DB owner),
# but it's harmless there too. For BRING-YOUR-OWN Postgres this is what unblocks migrations.
#
#   Usage:  DATABASE_URL=postgresql://aps:aps@localhost:5432/aps  bash scripts/db-provision.sh
#           (or run via:  npm run db:provision)
set -euo pipefail

DSN="${DATABASE_URL:-postgresql://aps:aps@localhost:5432/aps}"

# ---- localhost guard: never provision a remote DB by accident ----
host="$(printf '%s' "$DSN" | sed -E 's#.*@([^:/]+).*#\1#')"
case "$host" in
  localhost|127.0.0.1|0.0.0.0|::1|db) : ;;   # 'db' = the docker-compose service name
  *) echo "✗ Refusing to provision a non-local database (host: $host). Local hosts only." >&2; exit 1 ;;
esac

# Parse user / password / db out of the DSN
user="$(printf '%s' "$DSN" | sed -E 's#^[^:]+://([^:@/]+).*#\1#')"
pass="$(printf '%s' "$DSN" | sed -E 's#^[^:]+://[^:@/]+:([^@/]+)@.*#\1#')"
dbname="$(printf '%s' "$DSN" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"

# A superuser connection to create the role/db + grant ownership. We must NEVER hang waiting for a
# password prompt, so PGCONNECT_TIMEOUT is set and prompts are disabled (psql -w). Resolution order:
#   1) SUPERUSER_DSN if you set one (e.g. postgresql://postgres:pass@localhost:5432/postgres)
#   2) the local peer socket as the OS 'postgres' user (sudo -u postgres) — the usual local superuser
#   3) a plain TCP postgres@localhost (works if trust/no-password is configured)
export PGCONNECT_TIMEOUT=5
SU_MODE=""
if [ -n "${SUPERUSER_DSN:-}" ]; then
  if psql "$SUPERUSER_DSN" -w -tAc "SELECT 1" >/dev/null 2>&1; then SU_MODE="dsn"; fi
fi
if [ -z "$SU_MODE" ] && command -v sudo >/dev/null 2>&1 && sudo -n -u postgres psql -tAc "SELECT 1" >/dev/null 2>&1; then SU_MODE="sudo"; fi
if [ -z "$SU_MODE" ] && command -v sudo >/dev/null 2>&1 && sudo -u postgres psql -tAc "SELECT 1" >/dev/null 2>&1; then SU_MODE="sudo"; fi
if [ -z "$SU_MODE" ] && [ "$(id -u)" = "0" ] && su postgres -c 'psql -tAc "SELECT 1"' >/dev/null 2>&1; then SU_MODE="su"; fi
if [ -z "$SU_MODE" ] && psql "postgresql://postgres@localhost:5432/postgres" -w -tAc "SELECT 1" >/dev/null 2>&1; then SU_MODE="tcp"; fi
if [ -z "$SU_MODE" ]; then
  echo "✗ Could not open a superuser Postgres connection non-interactively." >&2
  echo "  Provide one of:" >&2
  echo "    • SUPERUSER_DSN=postgresql://postgres:PASSWORD@localhost:5432/postgres  (then re-run)" >&2
  echo "    • a local 'postgres' superuser reachable via  sudo -u postgres psql" >&2
  echo "  Docker users can skip this entirely — the compose Postgres is already provisioned." >&2
  exit 1
fi
psql_su() {
  case "$SU_MODE" in
    dsn)  psql "$SUPERUSER_DSN" -w -v ON_ERROR_STOP=1 -tAc "$1" ;;
    sudo) sudo -u postgres psql -v ON_ERROR_STOP=1 -tAc "$1" ;;
    su)   su postgres -c "psql -v ON_ERROR_STOP=1 -tAc \"$1\"" ;;
    tcp)  psql "postgresql://postgres@localhost:5432/postgres" -w -v ON_ERROR_STOP=1 -tAc "$1" ;;
  esac
}
psql_su_db() {  # run against a specific db
  local db="$1"; local q="$2"
  case "$SU_MODE" in
    dsn)  psql "$SUPERUSER_DSN" -w -v ON_ERROR_STOP=1 -d "$db" -c "$q" ;;
    sudo) sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -c "$q" ;;
    su)   su postgres -c "psql -v ON_ERROR_STOP=1 -d \"$db\" -c \"$q\"" ;;
    tcp)  psql "postgresql://postgres@localhost:5432/postgres" -w -v ON_ERROR_STOP=1 -d "$db" -c "$q" ;;
  esac
}

echo "▸ provisioning local DB '$dbname' for role '$user' (host: $host)…"

# role
if [ -z "$(psql_su "SELECT 1 FROM pg_roles WHERE rolname='${user}'" 2>/dev/null || true)" ]; then
  psql_su "CREATE ROLE \"${user}\" LOGIN PASSWORD '${pass}';" >/dev/null
  echo "  • created role ${user}"
else echo "  • role ${user} exists"; fi

# database (owned by the app role → owns public schema automatically on PG16)
if [ -z "$(psql_su "SELECT 1 FROM pg_database WHERE datname='${dbname}'" 2>/dev/null || true)" ]; then
  psql_su "CREATE DATABASE \"${dbname}\" OWNER \"${user}\";" >/dev/null
  echo "  • created database ${dbname} (owner ${user})"
else echo "  • database ${dbname} exists"; fi

# belt-and-suspenders: make sure the role can build the schema even on a pre-existing DB
psql_su_db "${dbname}" "ALTER DATABASE \"${dbname}\" OWNER TO \"${user}\";" >/dev/null 2>&1 || true
psql_su_db "${dbname}" "ALTER SCHEMA public OWNER TO \"${user}\";" >/dev/null 2>&1 || true
psql_su_db "${dbname}" "GRANT ALL ON SCHEMA public TO \"${user}\";" >/dev/null 2>&1 || true
echo "  • public schema owned by ${user}"
echo "✅ provision complete."
