#!/usr/bin/env bash
# db-reset.sh — DESTRUCTIVE local reset: drops every table, re-provisions, migrates, re-seeds.
# Guards: (1) refuses non-localhost DSNs, (2) requires CONFIRM=1. Local development ONLY.
#
#   Usage:  CONFIRM=1 npm run db:reset
set -euo pipefail
cd "$(dirname "$0")/.."

DSN="${DATABASE_URL:-postgresql://aps:aps@localhost:5432/aps}"
host="$(printf '%s' "$DSN" | sed -E 's#.*@([^:/]+).*#\1#')"

case "$host" in
  localhost|127.0.0.1|0.0.0.0|::1|db) : ;;
  *) echo "✗ REFUSING db:reset — '$host' is not a local host. This command only resets local dev databases." >&2; exit 1 ;;
esac
if [ "${CONFIRM:-0}" != "1" ]; then
  echo "✗ db:reset is destructive (drops ALL tables in $host). Re-run with:  CONFIRM=1 npm run db:reset" >&2
  exit 1
fi

export DATABASE_URL="$DSN"
echo "▸ [1/4] provisioning role + schema…"; bash scripts/db-provision.sh
dbname="$(printf '%s' "$DSN" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
echo "▸ [2/4] dropping & recreating the public schema in '$dbname'…"
psql "$DSN" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
# re-assert ownership after the recreate
bash scripts/db-provision.sh >/dev/null
echo "▸ [3/4] migrating…"; node apps/api/scripts/migrate.mjs
echo "▸ [4/4] seeding (base + demo + local accounts)…"
export REPO_DRIVER="${REPO_DRIVER:-postgres}" AUTH_SESSION_SECRET="${AUTH_SESSION_SECRET:-local-dev-secret-change-me}"
npx tsx apps/api/scripts/seed.ts
npx tsx apps/api/scripts/seed-demo.ts
npx tsx apps/api/scripts/seed-local-accounts.ts
echo "✅ Local database reset complete."
