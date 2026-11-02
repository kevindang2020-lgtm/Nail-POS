# LOCAL_DEVELOPMENT.md
### From clean checkout to running apps — every command is a real script from the root package.json
**Required:** Node 22.x (repo verified on v22.22.2) · npm (workspaces) · Docker (for local Postgres) — or any
Postgres 16 you point `DATABASE_URL` at. Redis is NOT required for local development.

## 1. Install (root — installs every workspace)
    npm install

## 2. Database
    npm run db:up          # docker compose up -d db   (local Postgres)
    npm run db:migrate     # node apps/api/scripts/migrate.mjs  → applies apps/api/db/migrations in order
    npm run db:seed        # tsx apps/api/scripts/seed.ts       → dev tenant PILOT01 + logins (see below)
No Docker? `npm run db:provision` / set `DATABASE_URL` yourself, then migrate + seed.

## 3. Build + start the API
    npm run build          # builds @aipowersalon/api → apps/api/dist
    npm run dev:api        # starts dist/main.js on :3000 with safe local env defaults baked into the script
The script's own defaults: `DATABASE_URL=postgresql://aps:aps@localhost:5432/aps`, `PAYMENTS_SANDBOX=1`,
dev session secret + MFA key. Override by exporting before the command.

## 4. Frontends (each on its own Vite port)
    npm run dev:pos        # Tenant POS
    npm run dev:admin      # Super Admin
    npm run dev:owner      # Owner app
    npm run dev:tech       # Technician app
    npm run dev:customer   # Customer app
    npm run dev:managerpay # Tap-to-Pay (manager)
    npm run dev            # everything at once (dev:all)

## 5. Development logins (from the seed — LOCAL ONLY)
Tenant owner: `owner@pilotsalon.com` / `ChangeMe!Owner1` · Super Admin: `admin@aipowersalon.com` /
`ChangeMe!SuperAdmin1` (any 6-digit code passes MFA locally). Tenant code `PILOT01`.

## 6. Tests & gates
    cd apps/api && npx vitest run --shard=1/8      # …through 8/8; sum the totals (current: 6,091 + 4 skipped, 0 failed)
    for g in di sql crosswire dead-client unreached perms public nav types-drift tenant dialogs money html no-print boot; do npm run check:$g; done
    npm run -s security:fast                        # the exact CI lane (from repo root or apps/api)
    node scripts/verify-migrations-pglite.mjs       # 432/432 on real Postgres semantics (PGlite/PG16)
Frontends: `npx vitest run` (pos-web needs `--shard=1/2` + `2/2`) and `npx vite build` in each app.
Live harnesses: `node apps/api/scripts/auth-matrix-e2e.mjs` (13 checks) · `npm run e2e:html` (browser journeys).

## 7. Where things are
API `apps/api` (NestJS 10, Kysely 0.27, Postgres) · migrations `apps/api/db/migrations` (432) · POS `apps/pos-web`
(React 18 + Vite 5) · Super Admin `apps/admin-web` · mobile-shell apps `customer-web`/`tech-web`/`owner-web`/
`manager-pay-web` (Capacitor) · kiosk HTML apps `go-check-in-*` · shared UI `packages/ui`.
Superseded quick-start notes (RUN_LOCAL.md, LOCAL_RUN_GUIDE.md, LOCAL_TESTING.md) remain for history — THIS file
is canonical.
