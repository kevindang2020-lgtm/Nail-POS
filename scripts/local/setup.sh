#!/usr/bin/env bash
# One-time local setup for AIPowerSalon: dependencies, Postgres, schema, and demo data.
# Safe to re-run (migrations + demo seed are idempotent).
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

[ -f .env ] || { cp .env.local.example .env; echo "Created .env from .env.local.example"; }
set -a; . ./.env; set +a

echo "==> Installing dependencies (npm install)…"
npm install

echo "==> Starting Postgres (docker compose up -d db)…"
docker compose up -d db

echo "==> Waiting for Postgres to accept connections…"
until docker compose exec -T db pg_isready -U aps -d aps >/dev/null 2>&1; do sleep 1; done
echo "    Postgres is ready."

echo "==> Applying migrations…"
npm run db:migrate
echo "==> Seeding platform admin + pilot tenant (admin@aipowersalon.com / owner@pilotsalon.com)…"
npm run db:seed
echo "==> Seeding demo operational data (technicians, services, customers, appointments, tickets)…"
npm run db:seed:demo
echo "==> Building the API…"
npm run build:api

echo ""
echo "✅ Setup complete."
echo "   Start everything with:   bash scripts/local/dev.sh"
