> **SUPERSEDED (Jul 30 2026).** Canonical doc: **LOCAL_DEVELOPMENT.md**. This file is preserved history — do not follow it for current commands.

# AIPowerSalon — Local Run Guide

Verified 2026-06-16: a fresh Postgres + these steps applies 86 migrations, seeds all 5 role accounts, and the API
boots (`/health` 200). Node 22, npm workspaces, Postgres 16.

## One-time setup
```bash
npm install

# Option A — Docker Postgres (nothing else to install):
USE_DOCKER_DB=1 npm run setup:local

# Option B — your own Postgres:
DATABASE_URL=postgres://user:pass@localhost:5432/aps npm run setup:local
```
`setup:local` builds the API, applies all migrations, and seeds the **Luxe Nails (LUXE)** tenant with the test accounts
below + demo data. It is **idempotent** (safe to re-run).

## Run everything (API + all 6 front-ends)
```bash
npm run dev:all        # api, pos, admin, tech, customer, owner, display (concurrently)
# or split:
npm run dev:backend    # = dev:api  (NestJS on :3000)
npm run dev:frontend   # all 6 Vite front-ends
# or individually:
npm run dev:api        # backend  :3000
npm run dev:pos        # POS      :5173
npm run dev:admin      # Super Admin :5174
npm run dev:tech       # Technician  :5175
npm run dev:customer   # Customer    :5176
npm run dev:owner      # Owner       :5177
npm run dev:display    # Customer Display :5180
```

## Database / seed
```bash
npm run db:up          # start local Postgres via docker-compose (if using docker)
npm run db:migrate     # apply all 86 migrations (tracked via schema_migrations)
npm run db:seed        # bootstrap seed (super admin + owner + tenant)
npm run seed:local     # add front-desk + technician + customer to the LUXE tenant
npm run db:seed:demo   # optional demo data
npm run db:down        # stop docker Postgres
```

## Build / test
```bash
npm run typecheck                 # API typecheck (clean)
npm run lint                      # 0 errors
npm test                          # backend core-spec harness (scripts/run-core-specs.sh)
bash scripts/run-core-specs.sh    # same, explicit
npm run build                     # API build; per app: cd apps/<app> && npm run build
# frontend unit tests: cd apps/<app> && npx vitest run
```

## Browser URLs (dev)
| Surface | URL | Sign-in |
|---|---|---|
| POS Front Desk (pos-web) | http://localhost:5173 | salon code **LUXE** + front-desk email + password |
| Super Admin (admin-web) | http://localhost:5174 | super-admin email + password (no salon code) |
| Technician app (tech-web) | http://localhost:5175 | salon code **LUXE** + technician email + password |
| Customer app (customer-web) | http://localhost:5176 | customer email + password |
| Owner app (owner-web) | http://localhost:5177 | salon code **LUXE** + owner email + password |
| Customer Display (customer-display) | http://localhost:5180 | device/token-scoped (opened from settings) |
| Go Check-In kiosk | open `apps/go-check-in-kiosk/index.html` (or serve it) | kiosk pairing |
| Public website | the WordPress theme / `aipowersalon.html` (served separately) | n/a (public form) |
| Backend API | http://localhost:3000 (health: `/health`) | — |

> Each front-end reads its API origin from `VITE_API_BASE` (kiosk: `window.APS_API_BASE`). For local dev it defaults to
> the local API; set it explicitly when pointing at a deployed backend.

## Test accounts (LOCAL ONLY — safe placeholders seeded by `setup:local`)
| Role | Email | Password | Where / how |
|---|---|---|---|
| Super Admin | `admin@aipowersalon.test` | `Admin123!` | Super Admin (5174), no salon code |
| Owner | `owner@luxenails.test` | `Owner123!` | Owner app (5177), salon code `LUXE` |
| Front Desk | `frontdesk@luxenails.test` | `FrontDesk123!` | POS (5173), salon code `LUXE` |
| Technician | `tech@luxenails.test` | `Tech123!` | Technician app (5175), salon code `LUXE` |
| Customer | `customer@test.com` | `Customer123!` | Customer app (5176) |

These are local development credentials only — change them (the seed reads `SEED_*` env vars) before any non-local use.
