#!/usr/bin/env bash
# db-status.sh — quick local DB health: connectivity, migration count, key row counts.
set -euo pipefail
cd "$(dirname "$0")/.."
DSN="${DATABASE_URL:-postgresql://aps:aps@localhost:5432/aps}"
echo "▸ DATABASE_URL host: $(printf '%s' "$DSN" | sed -E 's#.*@([^/]+)/.*#\1#')"
if ! psql "$DSN" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "✗ cannot connect. Is Postgres running?  (npm run db:start  for Docker)"; exit 1
fi
echo "✓ connected"
applied="$(psql "$DSN" -tAc "SELECT count(*) FROM schema_migrations" 2>/dev/null || echo '—')"
ondisk="$(ls apps/api/db/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')"
echo "  migrations applied: ${applied}   on disk: ${ondisk}"
if [ "$applied" != "$ondisk" ] && [ "$applied" != "—" ]; then echo "  ⚠ pending migrations — run: npm run db:migrate"; fi
echo "  tables: $(psql "$DSN" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo '—')"
echo "  tenants/users/technicians: $(psql "$DSN" -tAc "SELECT (SELECT count(*) FROM tenants)||'/'||(SELECT count(*) FROM users)||'/'||(SELECT count(*) FROM technicians)" 2>/dev/null || echo 'n/a — seed not run')"
