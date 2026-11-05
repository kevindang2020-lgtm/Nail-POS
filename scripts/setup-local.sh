#!/usr/bin/env bash
# setup-local.sh — one-time local setup for browser testing.
# Builds the API, applies migrations, and seeds a "Luxe Nails" tenant with the documented test accounts + demo data.
# Re-runnable: migrations and all seeds are idempotent.
#
# Two ways to provide Postgres:
#   A) Docker (no local Postgres needed):   USE_DOCKER_DB=1 npm run setup:local
#   B) Your own Postgres:                   DATABASE_URL=postgres://user:pass@localhost:5432/db npm run setup:local
#
set -euo pipefail
cd "$(dirname "$0")/.."

DOCKER_DSN="postgresql://aps:aps@localhost:5432/aps"

if [ "${USE_DOCKER_DB:-0}" = "1" ]; then
  echo "▸ starting Postgres via Docker (docker compose up -d db)…"
  docker compose up -d db
  export DATABASE_URL="$DOCKER_DSN"
  echo "▸ waiting for Postgres to be healthy…"
  for i in $(seq 1 40); do
    if docker compose exec -T db pg_isready -U aps -d aps >/dev/null 2>&1; then echo "  Postgres is ready."; break; fi
    sleep 2
    if [ "$i" = "40" ]; then echo "  Postgres did not become ready in time."; exit 1; fi
  done
else
  export DATABASE_URL="${DATABASE_URL:-$DOCKER_DSN}"
fi

export REPO_DRIVER="${REPO_DRIVER:-postgres}"
export AUTH_SESSION_SECRET="${AUTH_SESSION_SECRET:-local-dev-secret-change-me}"

# The Luxe Nails tenant + super-admin + owner (the rest of the accounts are added by seed-local-accounts).
export SEED_TENANT_CODE="${SEED_TENANT_CODE:-LUXE}"
export SEED_TENANT_NAME="${SEED_TENANT_NAME:-Luxe Nails}"
export SEED_SUPER_ADMIN_EMAIL="${SEED_SUPER_ADMIN_EMAIL:-admin@aipowersalon.test}"
export SEED_SUPER_ADMIN_PASSWORD="${SEED_SUPER_ADMIN_PASSWORD:-Admin123!}"
export SEED_OWNER_EMAIL="${SEED_OWNER_EMAIL:-owner@luxenails.test}"
export SEED_OWNER_PASSWORD="${SEED_OWNER_PASSWORD:-Owner123!}"

echo "▸ DATABASE_URL = $DATABASE_URL"
echo "▸ [0/5] provisioning local DB role + schema (PG16-safe)…"
bash scripts/db-provision.sh || echo "  (provision skipped — continuing; Docker path is already provisioned)"

echo "▸ [1/5] building API…"
npm run build --workspace @aipowersalon/api >/dev/null

echo "▸ [2/5] applying migrations…"
node apps/api/scripts/migrate.mjs

echo "▸ [3/5] seeding super-admin + Luxe Nails tenant + owner…"
npx tsx apps/api/scripts/seed.ts

echo "▸ [4/5] seeding demo operational data (services, techs, customers, appts, queue, tickets)…"
npx tsx apps/api/scripts/seed-demo.ts

echo "▸ [5/5] adding front-desk / technician / customer test logins…"
npx tsx apps/api/scripts/seed-local-accounts.ts

echo ""
echo "✅ Local setup complete."
if [ "${USE_DOCKER_DB:-0}" = "1" ]; then
  echo "   Start everything with:   npm run dev:all      (uses the Docker Postgres automatically)"
else
  echo "   Start everything with:   DATABASE_URL=$DATABASE_URL npm run dev:all"
fi
echo ""
echo "   Card payments run in SANDBOX/test mode locally (labeled sbx_) — no real Fiserv MID needed."
echo ""
echo "   Test accounts (salon code: $SEED_TENANT_CODE)"
echo "   ─────────────────────────────────────────────"
echo "   SUPER_ADMIN  $SEED_SUPER_ADMIN_EMAIL / $SEED_SUPER_ADMIN_PASSWORD   (admin-web; any 6-digit MFA code)"
echo "   OWNER        $SEED_OWNER_EMAIL / $SEED_OWNER_PASSWORD     (pos-web or owner-web; salon $SEED_TENANT_CODE)"
echo "   FRONT_DESK   frontdesk@luxenails.test / FrontDesk123!     (pos-web; salon $SEED_TENANT_CODE)"
echo "   TECHNICIAN   tech@luxenails.test / Tech123!               (tech-web; salon $SEED_TENANT_CODE)"
echo "   CUSTOMER     customer@test.com / Customer123!             (customer-web; salon $SEED_TENANT_CODE)"
