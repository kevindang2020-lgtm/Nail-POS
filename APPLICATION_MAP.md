# AI PowerSalon — Application Map

Monorepo: npm workspaces. Backend = NestJS/Kysely/Postgres 16. Frontends = Vite/React.

| App | Framework | Entry | Build | Test | Backend | Status |
|---|---|---|---|---|---|---|
| api | NestJS | src/main.ts (listens :3001) | tsc -p tsconfig.build | vitest (623) | self / Postgres | builds + tests pass |
| pos-web | Vite/React | src/main.tsx | vite build | vitest (84) | api same-origin | builds + tests pass |
| admin-web | Vite/React | src/main.tsx | vite build | vitest (168*) | api | last-verified green |
| owner-web | Vite/React | src/main.tsx | vite build | vitest (85*) | api | last-verified green |
| tech-web | Vite/React | src/main.tsx | vite build | vitest (74*) | api | last-verified green |
| customer-web | Vite/React | src/main.tsx | vite build | vitest (136*) | api | last-verified green |
| customer-display | Vite/React | src/main.tsx | vite build | vitest (26*) | api | last-verified green |
| go-check-in-kiosk | Capacitor | native shell | capacitor | — | api | native shell |

(*) counts last verified earlier this session; api + pos-web re-verified this turn.

Backend: 70 modules under apps/api/src (auth, pos, owner, platform/super-admin, ai, customer,
payments, hardware-payment, inventory, tenant-navigation, overview, dashboard, booking, queue,
checkout, …). DB: 109 SQL migrations in apps/api/db/migrations, runner scripts/migrate.mjs, seed scripts/seed.ts.
