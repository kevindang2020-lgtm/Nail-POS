# RUNBOOK.md

Exact steps to install, run, test, build, and troubleshoot AIPowerSalon. Package manager is **npm** (workspaces). Database is **Postgres 16**.

## Prerequisites
- Node.js (LTS) + npm
- Docker (for local Postgres via `docker-compose`)
- Git (optional; archive ships without `.git`)

## 1. Install
```bash
npm install            # installs all workspaces
```

## 2. Environment setup
```bash
cp .env.example .env   # then fill real values in your secrets manager (never commit)
```
See `docs/handoff/ENVIRONMENT_VARIABLES.md`. For in-memory dev (no DB), leave `REPO_DRIVER` unset.

## 3. Database + migrations + seed
```bash
npm run db:up          # docker compose up -d db  (local Postgres)
npm run db:setup       # db:migrate && db:seed && db:seed:demo
# individual: npm run db:migrate | npm run db:seed | npm run db:seed:demo
```

## 4. Start development
```bash
npm run dev:all        # api + all frontends (concurrently)
# or individually:
npm run dev:api        # NestJS API (sandbox defaults if env unset)
npm run dev:pos        # pos-web      npm run dev:admin   # admin-web
npm run dev:tech       # tech-web     npm run dev:customer# customer-web
npm run dev:owner      # owner-web    npm run dev:display # customer-display
```

## 5. Run tests
```bash
# Backend (DB-free core specs): from apps/api
cd apps/api && npm test        # → 57 harness suites / 778 tests
cd apps/api && npx tsc --noEmit

# Frontend (example: admin-web)
cd apps/admin-web && npx tsc --noEmit && npx vitest run && npm run build

# E2E money path (requires live DB)
npm run e2e:workflow
```

## 6. Production build
```bash
npm run build          # builds @aipowersalon/api → apps/api/dist
npm run start:api      # node apps/api/dist/main.js
# Frontends: per app, npm run build (Vite) → dist/
```

## 7. Troubleshooting
- **`tsc` errors after pull:** `npm install` to sync workspace deps, re-run typecheck.
- **DB connection refused:** ensure `npm run db:up` ran and `DATABASE_URL` points at it; append `?sslmode=require` for RDS.
- **In-memory mode:** unset `REPO_DRIVER` to use in-memory adapters for dev/tests (no Postgres).
- **`scripts/run-core-specs.sh` shell quirks:** `grep -cE` exits 1 when a count is 0 (not an error); no `${PIPESTATUS}` reliance.
- **Sessions invalid after deploy:** `AUTH_SESSION_SECRET` must be stable across instances.

## 8. Deployment (if applicable)
- Container: `Dockerfile` + `docker-compose.yml`; infra in `deploy/terraform/`; CI in `.github/workflows/`.
- App Runner-style: set `PORT`, `DATABASE_URL`, `AUTH_SESSION_SECRET`, payment/AI/Twilio secrets in the platform's secret store.
- See `DEPLOY_RUNBOOK.md`, `INTEGRATION_RUNBOOK.md`, `MULTI_INSTANCE_SCALING.md` for details.

## 9. Rollback
- Migrations are ordered and forward-only by default; restore from DB backup for destructive rollback (see `PRE_RESTORE_BACKUP_REPORT.md`). Never delete production data.
